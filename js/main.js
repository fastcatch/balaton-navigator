/**
 * Composition root: owns the app state and wires every module together.
 *
 * Data flows one way. Adapters (position, compass, map, tracker) and the UI
 * push events in here; this file mutates `state`, then calls `render()`,
 * which pushes derived values back out. Nothing reads state out of the DOM.
 */

import { createMap } from './map.js';
import { watchPosition, POSITION_ERROR } from './position.js';
import { watchHeading, compassNeedsPermission, isCompassSupported, requestCompassPermission } from './compass.js';
import { createTracker } from './tracker.js';
import {
  STORE_ROUTES, STORE_TRACKS,
  getAll, put, remove,
  loadAppState, saveAppState, loadSettings, saveSettings, requestPersistence,
  dismissSeed,
} from './storage.js';
import { applySeedRoutes } from './seeds.js';

import { computeNav, advanceIfArrived } from './core/navigation.js';
import { computeCog, computeSog, gpsFixQuality } from './core/cog.js';
import { computeInstruments } from './core/instruments.js';
import { renderableSegments } from './core/track.js';
import { trackToGpx, gpxFilename } from './core/gpx.js';
import {
  createRoute, createWaypoint,
  defaultWaypointName, defaultTrackName, defaultSettings,
} from './core/model.js';

import { el, replace } from './ui/dom.js';
import { createViewHost } from './ui/view.js';
import { renderNavPanel } from './ui/navpanel.js';
import { renderDataPanel } from './ui/datapanel.js';
import { renderRoutesView } from './ui/routes.js';
import { renderTracksView } from './ui/tracks.js';
import { renderSettings } from './ui/settings.js';
import { createPager } from './ui/pager.js';

/** Accuracy above which the fix is flagged as untrustworthy (spec 8). */
const POOR_ACCURACY_M = 100;
/** Accuracy at or below which the fix is as good as this app ever needs. */
const GOOD_ACCURACY_M = 20;

/**
 * How much fix history to keep for the COG filter.
 *
 * The longest damping setting is 10 s; the margin covers a fix arriving late.
 */
const COG_BUFFER_MS = 15000;

const $ = (id) => document.getElementById(id);

const state = {
  routes: [],
  tracks: [],
  activeRoute: null,
  targetIndex: 0,
  position: null,
  // Two different directions, deliberately not one field. The compass says
  // which way the phone is pointing; the GPS says which way the boat is
  // going. Merging them was what forced the phone to be held aligned with
  // the boat's axis to read a turn.
  viewHeading: null,
  cogSamples: [],
  cog: { cog: null, spreadDeg: null, status: 'nofix' },
  settings: defaultSettings(),
  positionError: null,
  addMode: false,
  shownTrackId: null,
  compassOffered: isCompassSupported() && compassNeedsPermission(),
  compassOn: false,
  online: navigator.onLine,
};

let map;
let tracker;
let views;
// The pager's own return value, kept so renderLive() can ask which page is
// showing. Without this main.js had no way to know, and rebuilt the data
// page's DOM on every compass reading — up to 60 Hz on iOS — even while it
// sat behind display:none.
let pager;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Persist the active route. Every mutation goes through here (spec 6.1: no save button). */
async function persistRoute() {
  if (!state.activeRoute) return;
  state.activeRoute.updatedAt = Date.now();
  await put(STORE_ROUTES, state.activeRoute);
  const i = state.routes.findIndex((r) => r.id === state.activeRoute.id);
  if (i >= 0) state.routes[i] = state.activeRoute;
}

/**
 * Persist which route is active and which waypoint is the target.
 *
 * Written on every change rather than on unload: iOS discards backgrounded
 * PWA tabs without warning, and losing the target index mid-passage would
 * silently point the navigator back at the first waypoint.
 */
function persistAppState() {
  return saveAppState({
    activeRouteId: state.activeRoute?.id ?? null,
    targetIndex: state.targetIndex,
    recordingTrackId: tracker?.track?.id ?? null,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function currentNav() {
  return computeNav(state.position, state.activeRoute, state.targetIndex, state.settings);
}

function renderBanners() {
  const banners = [];

  // Demo mode supplies its own position, so whatever the real watch is
  // complaining about is beside the point — and a "location is disabled"
  // error sitting above a boat that is plainly on the map reads as a fault.
  const positionError = DEMO_HEADING ? null : state.positionError;

  if (positionError === POSITION_ERROR.DENIED) {
    banners.push(
      el('div', { className: 'banner banner--error' }, [
        el('strong', { textContent: 'A helymeghatározás le van tiltva. ' }),
        document.createTextNode(
          'Engedélyezés: Beállítások › Safari › Helymeghatározás › Kérdezzen rá vagy Engedélyezés. ' +
            'Az útvonaltervezés addig is működik.'
        ),
      ])
    );
  } else if (positionError === POSITION_ERROR.UNSUPPORTED) {
    banners.push(el('div', { className: 'banner banner--error', textContent: 'Ez a böngésző nem támogatja a helymeghatározást.' }));
  } else if (positionError === POSITION_ERROR.UNAVAILABLE) {
    banners.push(el('div', { className: 'banner banner--warn', textContent: 'Nincs GPS-jel. Az app a legutóbbi ismert pozíciót mutatja.' }));
  }

  // Poor accuracy warns but never blocks (spec 8).
  if (state.position?.accuracy > POOR_ACCURACY_M) {
    banners.push(
      el('div', {
        className: 'banner banner--warn',
        textContent: `Gyenge GPS-pontosság: ±${Math.round(state.position.accuracy)} m. Az irány és távolság ennyivel tévedhet.`,
      })
    );
  }

  if (!state.online) {
    banners.push(el('div', { className: 'banner banner--warn', textContent: 'Nincs internet. A navigáció működik, új térképcsempék nem töltődnek be.' }));
  }

  // Said out loud because this mode invents a GPS fix. A boat sitting mid-lake
  // that never moves is confusing enough without having to guess why.
  if (DEMO_HEADING) {
    banners.push(el('div', { className: 'banner banner--warn', textContent: 'Demó: a látóirányt az egérmutató adja, a pozíció kitalált.' }));
  }

  if (state.compassOffered && !state.compassOn) {
    banners.push(
      el('div', { className: 'banner banner--warn' }, [
        document.createTextNode('Iránytű engedélyezhető a térképi látóirányhoz. '),
        el('button', { type: 'button', textContent: 'Engedélyezés', onClick: enableCompass }),
        el('button', { type: 'button', textContent: 'Nem kell', onClick: () => { state.compassOffered = false; render(); } }),
      ])
    );
  }

  replace($('banners'), banners);
}

/**
 * Identity of what is currently drawn as waypoints, so the markers are only
 * rebuilt when they actually differ.
 *
 * Recreating them on every fix has the same consequence as rebuilding a list:
 * the marker is replaced between touchstart and touchend, and the tap never
 * becomes a click.
 */
let drawnWaypoints = null;

function renderMapLayers() {
  const waypoints = state.activeRoute?.waypoints ?? [];
  const signature = [
    state.activeRoute?.id ?? '',
    state.targetIndex,
    waypoints.map((wp) => `${wp.id}:${wp.lat}:${wp.lon}:${wp.name}`).join(','),
  ].join('|');

  if (signature !== drawnWaypoints) {
    drawnWaypoints = signature;
    map.setWaypoints(waypoints, state.targetIndex);
  }

  // One track at a time: the live recording, or a historical one being
  // reviewed. Showing both at once would be ambiguous.
  const points = state.shownTrackId
    ? state.tracks.find((t) => t.id === state.shownTrackId)?.points ?? []
    : tracker.points;

  if (points.length > 0) {
    map.setTrack(renderableSegments(points, map.getZoom()));
  } else {
    map.clearTrack();
  }
}

/**
 * Fix quality as a coarse band, for the header dot.
 *
 * A number would need reading; this only needs seeing. It does not replace
 * the poor-accuracy banner — it is the always-on version of it, so a figure
 * that looks wrong has an explanation without waiting for a threshold.
 *
 * A fix reporting no accuracy at all counts as 'fair': we have a position
 * and no specific reason to doubt it, which is the same call
 * `isAccuracyUsable` makes in navigation.js.
 *
 * Age is judged in `gpsFixQuality` itself against `STALE_MS`, the same
 * constant `computeCog`/`computeSog` decay against — otherwise the compass
 * keeps `renderLive()` firing at up to 60 Hz with no new fix arriving, and
 * the dot would stay solid green while SOG, COG and VMC quietly decayed to
 * em dashes underneath it. `nowT` is threaded in from the caller rather than
 * read here, so the dot is judged against the exact same instant as the COG
 * and SOG filters for this render — two clock reads per render is exactly
 * the inconsistency this codebase avoids elsewhere.
 */
function gpsQuality(position, nowT) {
  return gpsFixQuality(position, nowT, {
    goodAccuracyM: GOOD_ACCURACY_M,
    poorAccuracyM: POOR_ACCURACY_M,
  });
}

/**
 * Everything that changes on a GPS fix or a compass reading.
 *
 * Deliberately does NOT rebuild the open list views — see `render()`.
 */
function renderLive() {
  const nav = currentNav();

  // Computed here rather than in onPosition so the readout also refreshes on
  // compass updates, and so it decays to 'nofix' when fixes stop arriving.
  const windowMs = state.settings.cogDampingS * 1000;
  const nowT = Date.now();
  state.cog = computeCog(state.cogSamples, { windowMs, nowT });

  const instruments = computeInstruments({
    position: state.position,
    route: state.activeRoute,
    targetIndex: state.targetIndex,
    nav,
    cog: state.cog,
    sogMps: computeSog(state.cogSamples, { windowMs, nowT }),
  });

  renderNavPanel($('navpanel'), { nav, cog: state.cog, instruments, settings: state.settings });

  // Only rebuilt while actually showing: the compass drives this function at
  // up to 60 Hz on iOS with no throttle, and rebuilding a display:none page's
  // DOM on every one of those readings is pure waste. Populated on arrival
  // instead by the pager's onChange, below, rather than waiting for the next
  // GPS fix.
  if (pager?.page === 'data') {
    renderDataPanel($('datapanel'), { instruments, cog: state.cog, settings: state.settings });
  }

  renderBanners();
  renderMapLayers();

  $('route-name').textContent = state.activeRoute
    ? `${state.activeRoute.name} · ${state.activeRoute.waypoints.length} WP`
    : 'Nincs aktív útvonal';

  $('recenter').classList.toggle('is-hidden', map.isFollowing);
  // Only offered when there is actually a route on the map to frame.
  $('fit-route').classList.toggle('is-hidden', !(state.activeRoute?.waypoints.length > 0));
  $('add-hint').classList.toggle('is-hidden', !state.addMode);
  $('btn-add').classList.toggle('is-active', state.addMode);
  $('btn-record').classList.toggle('is-recording', tracker.isRecording);
  $('btn-record').textContent = tracker.isRecording ? '■ Állj' : '● Rögzít';
  $('gps-dot').className = `gps-dot gps-dot--${gpsQuality(state.position, nowT)}`;
}

/**
 * A full render, including any open list view.
 *
 * Call this only when the underlying data actually changed — never on a
 * position or heading update.
 *
 * Rebuilding a list replaces its DOM. `watchPosition` fires about once a
 * second on a phone and the compass far more often, so doing this on every
 * update tears the buttons out from under the user's finger. iOS only
 * synthesises a click when touchstart and touchend land on the same element,
 * so taps in the list silently did nothing on iPhone while GPS was live —
 * while working fine on a desktop, where no fixes arrive.
 */
function render() {
  renderLive();
  views.update('routes', renderRoutesView({ ...state, actions: routeActions }));
  views.update('tracks', renderTracksView({ ...state, actions: trackActions }));
}

// ---------------------------------------------------------------------------
// Position handling
// ---------------------------------------------------------------------------

async function onPosition(position) {
  state.position = position;
  state.positionError = null;

  // Kept whether or not a track is recording: the turn indicator needs recent
  // fixes regardless. Nothing here touches viewHeading — GPS course reaches
  // the panel through the filter and must never be drawn as a sight line.
  state.cogSamples.push(position);
  const cutoff = position.t - COG_BUFFER_MS;
  while (state.cogSamples.length > 0 && state.cogSamples[0].t < cutoff) {
    state.cogSamples.shift();
  }

  if (tracker.isRecording) tracker.addPoint(position, state.settings);

  const advanced = advanceIfArrived(position, state.activeRoute, state.targetIndex, state.settings);
  const targetChanged = advanced !== state.targetIndex;
  if (targetChanged) {
    state.targetIndex = advanced;
    await persistAppState();
  }

  map.setPosition(position, state.viewHeading);

  // A full render only when the target actually moved — once per waypoint,
  // not once per second — so an open list is not rebuilt under the user.
  if (targetChanged) render();
  else renderLive();
}

function onPositionError(kind) {
  // A timeout is not fatal: the watch stays live and may recover.
  if (kind === POSITION_ERROR.TIMEOUT) return;
  state.positionError = kind;
  renderLive();
}

/**
 * Demo mode: `?demo=heading` points the sight line at the mouse.
 *
 * A desktop has no compass, so the cone, the sight line and the heading
 * figures simply never appear there — the one part of the map that cannot be
 * looked at while developing it. This stands in for the sensor: the bearing
 * from the boat to the pointer, fed through exactly the path a real reading
 * takes, so what is on screen is the real code and not a mock of it.
 *
 * It also seeds a position, because without a fix there is no marker to hang
 * any of it on and the flag would appear to do nothing. Seeded only if the
 * real watch has not already produced one, and a genuine fix arriving later
 * overwrites it like any other.
 */
const DEMO_HEADING = new URLSearchParams(location.search).get('demo') === 'heading';

/** Open water in the Szántód–Tihany strait, so the seeded boat is afloat. */
const DEMO_POSITION = { lat: 46.882, lon: 17.888 };

function startHeadingDemo() {
  if (!state.position) {
    onPosition({ ...DEMO_POSITION, accuracy: 10, speed: null, heading: null, t: Date.now() });
  }

  map.onPointerBearing((heading) => {
    state.viewHeading = heading;
    map.setHeading(heading);
    renderLive();
  });
}

async function enableCompass() {
  const granted = await requestCompassPermission();
  state.compassOffered = false;
  if (granted) {
    state.compassOn = true;
    watchHeading({
      onHeading: (heading) => {
        state.viewHeading = heading;
        // Straight to the map: the cone and sight line must follow the boat
        // turning, which happens far more often than a new GPS fix arrives.
        map.setHeading(heading);
        // Compass readings arrive many times a second — never a full render.
        renderLive();
      },
    });
  }
  render();
}

// ---------------------------------------------------------------------------
// Route actions
// ---------------------------------------------------------------------------

async function addWaypoint(lat, lon, name) {
  if (!state.activeRoute) {
    const route = createRoute({});
    state.routes.push(route);
    state.activeRoute = route;
    state.targetIndex = 0;
  }
  const wp = createWaypoint({
    name: name || defaultWaypointName(state.activeRoute.waypoints.length),
    lat,
    lon,
  });
  state.activeRoute.waypoints.push(wp);
  await persistRoute();
  await persistAppState();
  render();
}

const routeActions = {
  onSelectRoute: async (id) => {
    state.activeRoute = state.routes.find((r) => r.id === id) ?? null;
    state.targetIndex = 0;
    await persistAppState();
    render();
  },

  onCreateRoute: async () => {
    const route = createRoute({});
    state.routes.push(route);
    state.activeRoute = route;
    state.targetIndex = 0;
    await put(STORE_ROUTES, route);
    await persistAppState();
    render();
  },

  onDeleteRoute: async (route) => {
    if (!confirm(`Törlöd ezt az útvonalat: „${route.name}”?`)) return;
    await remove(STORE_ROUTES, route.id);
    // Remember the deletion, or the next launch would restore it.
    if (route.seedId) await dismissSeed(route.seedId);
    state.routes = state.routes.filter((r) => r.id !== route.id);
    if (state.activeRoute?.id === route.id) {
      state.activeRoute = null;
      state.targetIndex = 0;
    }
    await persistAppState();
    render();
  },

  onRenameRoute: async (route) => {
    const name = prompt('Útvonal neve:', route.name);
    if (name === null || name.trim() === '') return;
    route.name = name.trim();
    await persistRoute();
    render();
  },

  onMoveWaypoint: async (index, delta) => {
    const wps = state.activeRoute.waypoints;
    const to = index + delta;
    if (to < 0 || to >= wps.length) return;
    [wps[index], wps[to]] = [wps[to], wps[index]];

    // Keep pointing at the same physical waypoint after a reorder, rather
    // than at whatever moved into its slot.
    if (state.targetIndex === index) state.targetIndex = to;
    else if (state.targetIndex === to) state.targetIndex = index;

    await persistRoute();
    await persistAppState();
    render();
  },

  onRenameWaypoint: async (index) => {
    const wp = state.activeRoute.waypoints[index];
    const name = prompt('Waypoint neve:', wp.name);
    if (name === null || name.trim() === '') return;
    wp.name = name.trim();
    await persistRoute();
    render();
  },

  onDeleteWaypoint: async (index) => {
    state.activeRoute.waypoints.splice(index, 1);
    // Shift the target so it still refers to the same waypoint. Deleting the
    // target itself leaves the index in place, which now means "the next one".
    if (state.targetIndex > index) state.targetIndex -= 1;
    state.targetIndex = Math.min(state.targetIndex, state.activeRoute.waypoints.length);
    await persistRoute();
    await persistAppState();
    render();
  },

  onSetTarget: async (index) => {
    state.targetIndex = index;
    await persistAppState();
    render();
  },

  onAddCoordinate: (lat, lon, name) => addWaypoint(lat, lon, name),
};

// ---------------------------------------------------------------------------
// Track actions
// ---------------------------------------------------------------------------

const trackActions = {
  onShowTrack: (track) => {
    // Tapping the shown track again hides it and returns to the live view.
    state.shownTrackId = state.shownTrackId === track.id ? null : track.id;
    if (state.shownTrackId && track.points.length > 0) {
      map.setFollow(false);
      map.fitPoints(track.points);
      views.close();
    }
    render();
  },

  onExportTrack: (track) => {
    const blob = new Blob([trackToGpx(track)], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: gpxFilename(track) });
    document.body.append(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download on some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  onDeleteTrack: async (track) => {
    if (!confirm(`Törlöd ezt a track-et: „${track.name}”?`)) return;
    await remove(STORE_TRACKS, track.id);
    state.tracks = state.tracks.filter((t) => t.id !== track.id);
    if (state.shownTrackId === track.id) state.shownTrackId = null;
    render();
  },
};

async function toggleRecording() {
  if (tracker.isRecording) {
    const finished = await tracker.stop();
    if (finished) {
      const i = state.tracks.findIndex((t) => t.id === finished.id);
      if (i >= 0) state.tracks[i] = finished;
      else state.tracks.push(finished);
    }
  } else {
    const track = await tracker.start({
      name: defaultTrackName(),
      routeId: state.activeRoute?.id ?? null,
      keepAwake: state.settings.keepAwake,
    });
    state.tracks.push(track);
    state.shownTrackId = null; // live track takes over the map
  }
  await persistAppState();
  render();
}

// ---------------------------------------------------------------------------
// Waypoint popup (spec 6.1)
// ---------------------------------------------------------------------------

function openWaypointPopup(index, wp) {
  const action = (label, handler, className = '') =>
    el('button', {
      type: 'button',
      className,
      textContent: label,
      style: 'width:100%;margin-bottom:6px',
      onClick: async () => {
        map.closePopup();
        await handler();
      },
    });

  map.openPopup(wp.lat, wp.lon, el('div', { style: 'min-width:160px' }, [
    el('div', { style: 'font-weight:700;margin-bottom:8px;color:#0b1f33', textContent: `${index + 1}. ${wp.name}` }),
    index === state.targetIndex
      ? el('div', { style: 'font-size:12px;color:#0b1f33;margin-bottom:8px', textContent: 'Ez az aktuális cél.' })
      : action('🎯 Kijelölés célnak', () => routeActions.onSetTarget(index), 'btn-primary'),
    action('✎ Átnevezés', () => routeActions.onRenameWaypoint(index)),
    action('✕ Törlés', () => routeActions.onDeleteWaypoint(index)),
  ]));
}

/** Settings re-open themselves after a change so the controls show the new values. */
function openSettings() {
  views.open('settings', 'Beállítások', renderSettings({
    settings: state.settings,
    onChange: async (next) => {
      state.settings = next;
      await saveSettings(next);
      openSettings();
      render();
    },
  }));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  requestPersistence();

  views = createViewHost({
    root: $('view'),
    titleEl: $('view-title'),
    bodyEl: $('view-body'),
    backButton: $('view-back'),
    onClose: () => map.invalidateSize(),
  });

  map = createMap('map', {
    onMapClick: (lat, lon) => {
      // Only an armed add-mode places a waypoint, so a stray tap while
      // navigating cannot silently extend the route.
      if (state.addMode) addWaypoint(lat, lon);
    },
    onWaypointClick: openWaypointPopup,
    onFollowChange: () => render(),
  });

  map.onZoom(() => renderMapLayers());

  // Swipe surfaces are the two panels, never the map: Leaflet owns
  // horizontal drags there for panning.
  //
  // The handle is kept (module-level `pager`, not discarded) so renderLive()
  // can ask which page is showing before rebuilding the data page's DOM.
  pager = createPager({
    surfaces: [$('navpanel'), $('datapanel')],
    dots: $('pagedots'),
    onChange: (page) => {
      $('datapanel').classList.toggle('is-hidden', page !== 'data');
      // Populate on arrival rather than waiting for the next GPS fix — the
      // guard in renderLive() means nothing has been drawing into a hidden
      // data page, so it would otherwise show whatever was last rendered
      // before the swipe, or nothing at all on the very first visit.
      if (page === 'data') renderLive();
    },
  });

  tracker = createTracker({ onChange: () => {} });

  // --- Restore ------------------------------------------------------
  const [settings, appState, routes, tracks] = await Promise.all([
    loadSettings(),
    loadAppState(),
    getAll(STORE_ROUTES),
    getAll(STORE_TRACKS),
  ]);

  state.settings = settings;
  state.tracks = tracks ?? [];

  // Merge in the routes shipped with the app before resolving which one is
  // active, so a freshly seeded route can be selected on the very first run.
  const { routes: allRoutes, inserted } = await applySeedRoutes(routes ?? []);
  state.routes = allRoutes;

  state.activeRoute = state.routes.find((r) => r.id === appState.activeRouteId) ?? null;
  state.targetIndex = appState.targetIndex ?? 0;

  // Nothing was selected and a route just arrived with the app: open on it.
  // Otherwise a shipped race course would sit in a list, needing two taps on
  // the morning it is actually wanted. An existing selection is never
  // overridden.
  if (!state.activeRoute && inserted.length > 0) {
    state.activeRoute = inserted[0];
    state.targetIndex = 0;
    await persistAppState();
  }

  // A recording interrupted by a discarded tab resumes rather than being
  // orphaned half-written.
  if (appState.recordingTrackId) {
    const open = state.tracks.find((t) => t.id === appState.recordingTrackId && t.endedAt === null);
    if (open) await tracker.resume(open, { keepAwake: state.settings.keepAwake });
  }

  // --- Wire controls ------------------------------------------------
  $('btn-add').addEventListener('click', () => {
    state.addMode = !state.addMode;
    render();
  });

  $('btn-record').addEventListener('click', toggleRecording);

  $('btn-routes').addEventListener('click', () =>
    views.open('routes', 'Útvonalak', renderRoutesView({ ...state, actions: routeActions })));

  $('btn-tracks').addEventListener('click', () =>
    views.open('tracks', 'Track-ek', renderTracksView({ ...state, actions: trackActions })));

  $('btn-settings').addEventListener('click', openSettings);

  $('route-name').addEventListener('click', () =>
    views.open('routes', 'Útvonalak', renderRoutesView({ ...state, actions: routeActions })));

  $('recenter').addEventListener('click', () => {
    map.setFollow(true);
    render();
  });

  $('fit-route').addEventListener('click', () => {
    const waypoints = state.activeRoute?.waypoints ?? [];
    if (waypoints.length === 0) return;
    // Release follow first, or the next GPS fix would immediately pan back to
    // the boat and undo the framing.
    map.setFollow(false);
    map.fitPoints(waypoints, { clearControls: true });
    render();
  });

  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });

  // --- Go -----------------------------------------------------------
  watchPosition({ onPosition, onError: onPositionError });

  if (DEMO_HEADING) startHeadingDemo();

  // Nothing else drives a render when the data stops arriving.
  //
  // Every other render is triggered by a GPS fix or a compass reading, so if
  // both stop the panel simply holds whatever it last drew — for as long as
  // the app is open. That was survivable when the readout was a bearing and a
  // distance, which change slowly and are wrong by metres. It is not
  // survivable now: SOG would sit at six knots on a boat that has been
  // drifting for a minute, and a TIMEOUT is deliberately swallowed (see
  // onPositionError) so nothing else says otherwise.
  //
  // The filters already decay correctly — computeCog and computeSog both go
  // null past STALE_MS, and the header dot follows. They just need something
  // to ask them. One second matches the fix rate, so this adds no work on the
  // common path where fixes are arriving anyway.
  setInterval(renderLive, 1000);

  render();

  if ('serviceWorker' in navigator) {
    // Relative path so the registration scope follows the deployment path,
    // which on GitHub Pages is a subdirectory rather than the domain root.
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is a bonus; the app is fully usable without it.
    });
  }
}

boot();
