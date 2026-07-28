/**
 * Leaflet map adapter.
 *
 * Everything that knows about Leaflet lives here. The rest of the app passes
 * plain data in and receives plain callbacks out.
 *
 * Leaflet is loaded as a global by a plain <script> tag rather than imported,
 * because it ships as a UMD bundle and this project has no build step.
 */

/* global L */

import { haversine, destinationPoint, relativeBearing, initialBearing, formatBearing } from './core/geo.js';

/** Bounding box for the opening view, before any GPS fix arrives. */
const BALATON_VIEW = [
  [46.68, 17.19],
  [47.08, 18.15],
];

/**
 * Tile sources (spec section 4).
 *
 * Only tiles the user actually looks at are ever requested — no prefetching,
 * no region download. That is what keeps this within the OSM tile usage
 * policy (operations.osmfoundation.org/policies/tiles).
 *
 * SCALING NOTE: if this app ever gets meaningful traffic, the OSM community
 * servers are the wrong place to get tiles from. Swap the base layer URL for
 * a paid provider (MapTiler, Thunderforest) or a self-hosted renderer. That
 * is a one-line change here and needs no other modification.
 */
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEAMARK_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők';
const SEAMARK_ATTRIBUTION = '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a>';

/**
 * Colours for the facing indicators.
 *
 * Magenta rather than blue: the base map is largely blue water and green
 * land, and a blue sight line vanishes into the lake in bright sun. Magenta
 * is also the nautical-chart convention for course lines, and stays distinct
 * from the brass waypoints and the orange track.
 *
 * Blue stays reserved for the position dot — blue is where you are, magenta
 * is where you are looking.
 */
const HEADING_COLOR = '#ff2d95';
const HEADING_CASING = '#2b0a1c';

/**
 * Own-position marker: a view cone behind a dot, and the heading in figures
 * astern.
 *
 * The whole element is rotated to the heading. The cone fades out towards
 * its far edge, because the direction is known far more precisely than how
 * far ahead the sailor can actually see — a hard edge would suggest a range
 * the app is not measuring.
 *
 * The figures go ASTERN, which is the one placement that keeps them out of
 * the way: the forward half of the sight line is the half being aimed at
 * marks, so a label anywhere along it obscures the thing it describes, while
 * abaft the beam is dead space. Riding on the marker also means the boat
 * being centred keeps the figures on screen at any zoom, which a label
 * further out along the line could not promise.
 *
 * A number sitting on the 057 side of the boat while reading 237 is an
 * invitation to a reciprocal error, so it is drawn as a label on an AXIS
 * rather than a mark in a direction: the stub continues the sight line
 * abaft, dimmer than the line forward of the boat, and the figures hang off
 * the end of it. Bright end forward, dim end aft, one line through the boat.
 * The cone remains the only thing asserting which way is ahead.
 */
const POSITION_MARKER_HTML = `
<div class="pos-marker">
  <svg class="pos-marker__cone" viewBox="-38 -38 76 76" width="76" height="76" aria-hidden="true">
    <defs>
      <linearGradient id="cone-fade" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="${HEADING_COLOR}" stop-opacity="0.9"/>
        <stop offset="1" stop-color="${HEADING_COLOR}" stop-opacity="0.1"/>
      </linearGradient>
    </defs>
    <path d="M0 0 L-18 -31 A36 36 0 0 1 18 -31 Z"
          fill="url(#cone-fade)"
          stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>
  <div class="pos-marker__stub"></div>
  <div class="pos-marker__tag"><div class="pos-marker__tag-chip"></div></div>
  <div class="pos-marker__dot"></div>
</div>`;

export function createMap(elementId, { onMapClick, onWaypointClick, onFollowChange } = {}) {
  const map = L.map(elementId, {
    zoomControl: false,
    attributionControl: true,
    tap: false, // Leaflet's tap emulation misfires on modern iOS
  }).fitBounds(BALATON_VIEW);

  // Leaflet's own "Leaflet" credit is a courtesy under its BSD licence, not a
  // requirement. Dropped because the strip has to hold the OSM and OpenSeaMap
  // credits, which ARE required and must stay legible on a phone.
  map.attributionControl.setPrefix('');

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer(OSM_URL, {
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
    crossOrigin: true,
  }).addTo(map);

  L.tileLayer(SEAMARK_URL, {
    maxZoom: 18,
    attribution: SEAMARK_ATTRIBUTION,
    crossOrigin: true,
    // The overlay is sparse; missing tiles are normal, not an error worth
    // retrying or reporting.
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  }).addTo(map);

  const waypointLayer = L.layerGroup().addTo(map);
  const routeLine = L.polyline([], {
    color: '#c9a24b',
    weight: 2,
    dashArray: '6 6',
    interactive: false,
  }).addTo(map);
  const trackLayer = L.layerGroup().addTo(map);

  /**
   * Sight line from the boat along the current heading, drawn out past the
   * edge of the view so it reaches whatever is being looked at rather than
   * stopping at an arbitrary length.
   *
   * Drawn as two polylines: a dark casing under a bright core. A single line
   * cannot stay legible across this map — pale over sunlit water, dark over
   * shadowed land — whereas an outlined one reads against both. The casing
   * is solid so the gaps between the core's dashes stay visible too.
   */
  const headingCasing = L.polyline([], {
    color: HEADING_CASING,
    weight: 8,
    opacity: 0.55,
    lineCap: 'round',
    interactive: false,
  }).addTo(map);

  const headingLine = L.polyline([], {
    color: HEADING_COLOR,
    weight: 4,
    opacity: 1,
    // Long dashes with short breaks: still reads as a projection rather than
    // a course to steer, without the even dash/gap that looks like the
    // railway symbol on a map.
    dashArray: '28 8',
    lineCap: 'butt',
    interactive: false,
  }).addTo(map);

  let positionMarker = null;
  let accuracyCircle = null;
  let following = true;
  let hasFix = false;
  let lastPosition = null;
  let lastHeading = null;

  /**
   * Heading as an unwrapped, continuously accumulating angle.
   *
   * The CSS transition interpolates numerically, so going from 359 to 1
   * would animate backwards through the whole circle. Accumulating the
   * shortest signed step keeps the cone swinging the short way instead.
   */
  let displayHeading = null;

  function advanceDisplayHeading(heading) {
    if (heading == null) return;
    if (displayHeading == null) {
      displayHeading = heading;
      return;
    }
    const current = ((displayHeading % 360) + 360) % 360;
    displayHeading += relativeBearing(heading, current);
  }

  /**
   * Keep Leaflet's cached container size honest.
   *
   * Leaflet measures the container once and then only re-measures on a window
   * resize. #map-wrap is flex:1 — its height is whatever the header, banners
   * and navpanel leave over — so it changes size constantly without the
   * window ever resizing: a banner appears, the navpanel is rebuilt taller.
   *
   * The worst case is the very first one. createMap runs before the opening
   * render, when #navpanel is still an empty section 21px tall, so Leaflet
   * caches a container 186px taller than the one it ends up with. Every
   * centring operation then aims at half of that: panTo puts the boat 93px
   * below the middle of the visible map, which on a phone is the lower third.
   * Nothing looks broken — the map is simply, quietly, aimed wrong.
   *
   * Left to the default `pan: true`, invalidateSize preserves the geographic
   * centre across the correction, which is the right answer both with a fix
   * (the centre is the boat, so the boat re-centres) and without one (the
   * opening Balaton view stays put). No feedback loop: this moves the map
   * pane, never the container.
   */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());
  }

  // Panning by hand turns off following so the user can look around freely
  // (spec 6.2). Programmatic setView does not fire dragstart, so this needs
  // no suppression flag. Pinch-zoom deliberately does not break follow.
  map.on('dragstart', () => {
    if (!following) return;
    following = false;
    onFollowChange?.(false);
  });

  map.on('click', (e) => onMapClick?.(e.latlng.lat, e.latlng.lng));

  /**
   * Redraw the sight line so it runs from the boat to just beyond the
   * furthest visible corner. Recomputed on pan and zoom, since both change
   * how far "off screen" is.
   *
   * Drawn only when a heading was actually measured — never inferred, so the
   * line cannot imply a direction the app does not know.
   */
  function updateHeadingLine() {
    if (!lastPosition || lastHeading == null) {
      headingLine.setLatLngs([]);
      headingCasing.setLatLngs([]);
      return;
    }

    const bounds = map.getBounds();
    const corners = [
      bounds.getNorthWest(), bounds.getNorthEast(),
      bounds.getSouthWest(), bounds.getSouthEast(),
    ];

    let reach = 0;
    for (const corner of corners) {
      reach = Math.max(reach, haversine(lastPosition, { lat: corner.lat, lon: corner.lng }));
    }

    const end = destinationPoint(lastPosition, lastHeading, reach * 1.1);
    const path = [
      [lastPosition.lat, lastPosition.lon],
      [end.lat, end.lon],
    ];
    headingCasing.setLatLngs(path);
    headingLine.setLatLngs(path);
  }

  map.on('moveend zoomend', updateHeadingLine);

  /**
   * Point the marker's cone along the heading, or hide it if there is none.
   *
   * The chip is counter-rotated by exactly what the marker was rotated by, so
   * the figures stay upright however the boat lies. Cancelling `displayHeading`
   * rather than `heading` matters: the two differ by whole turns once the
   * accumulator has wound past 360, and cancelling the wrong one would spin
   * the text the long way round while the marker took the short way.
   */
  function applyMarkerRotation(heading) {
    // firstElementChild, not firstChild: the icon markup is indented, so
    // firstChild is a text node with no style or classList.
    const el = positionMarker?.getElement()?.firstElementChild;
    if (!el) return;
    el.style.transform = heading == null ? '' : `rotate(${displayHeading}deg)`;
    el.classList.toggle('pos-marker--heading', heading != null);

    const chip = el.querySelector('.pos-marker__tag-chip');
    if (!chip) return;
    chip.style.transform = heading == null ? '' : `rotate(${-displayHeading}deg)`;
    // True, not magnetic: watchHeading has already applied the declination,
    // and the panel's Irányszög is true. Two figures meant to be compared at
    // a glance cannot be on different references.
    chip.textContent = heading == null ? '' : formatBearing(heading);
  }

  function waypointIcon(number, isTarget) {
    return L.divIcon({
      className: '',
      html: `<div class="wp-marker${isTarget ? ' wp-marker--target' : ''}">${number}</div>`,
      iconSize: isTarget ? [38, 38] : [28, 28],
      iconAnchor: isTarget ? [19, 19] : [14, 14],
    });
  }

  return {
    get leaflet() {
      return map;
    },

    get isFollowing() {
      return following;
    },

    /** Draw the route: numbered markers plus the dashed line joining them. */
    setWaypoints(waypoints, targetIndex) {
      waypointLayer.clearLayers();

      waypoints.forEach((wp, i) => {
        L.marker([wp.lat, wp.lon], {
          icon: waypointIcon(i + 1, i === targetIndex),
          keyboard: false,
          // Draw the active target above its neighbours so it stays legible
          // where waypoints are close together.
          zIndexOffset: i === targetIndex ? 1000 : 0,
        })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e); // do not also drop a new waypoint
            onWaypointClick?.(i, wp);
          })
          .addTo(waypointLayer);
      });

      routeLine.setLatLngs(waypoints.map((wp) => [wp.lat, wp.lon]));
    },

    /** Move the own-position marker, and recentre if following. */
    setPosition(position, heading) {
      if (!position) return;
      const latlng = [position.lat, position.lon];
      lastPosition = position;
      lastHeading = heading ?? null;

      if (!positionMarker) {
        accuracyCircle = L.circle(latlng, {
          radius: position.accuracy ?? 0,
          color: '#4da3ff',
          weight: 1,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(map);

        positionMarker = L.marker(latlng, {
          icon: L.divIcon({ className: '', html: POSITION_MARKER_HTML, iconSize: [76, 76], iconAnchor: [38, 38] }),
          interactive: false,
          zIndexOffset: 2000,
        }).addTo(map);
      } else {
        positionMarker.setLatLng(latlng);
        accuracyCircle.setLatLng(latlng);
        accuracyCircle.setRadius(position.accuracy ?? 0);
      }

      advanceDisplayHeading(heading);
      applyMarkerRotation(heading);
      updateHeadingLine();

      if (!hasFix) {
        hasFix = true;
        map.setView(latlng, Math.max(map.getZoom(), 14));
      } else if (following) {
        map.panTo(latlng, { animate: true, duration: 0.4 });
      }
    },

    /**
     * Update only the heading.
     *
     * Compass readings arrive far more often than GPS fixes, and while lying
     * at anchor no fix may arrive at all. Routing them through setPosition
     * would either stall the cone or trigger a recentre on every reading.
     */
    setHeading(heading) {
      lastHeading = heading ?? null;
      advanceDisplayHeading(heading);
      applyMarkerRotation(heading);
      updateHeadingLine();
    },

    /** Draw a track as one or more polylines, split at recording gaps. */
    setTrack(segments, { color = '#ff8a3d', weight = 3 } = {}) {
      trackLayer.clearLayers();
      for (const segment of segments) {
        if (segment.length < 2) continue;
        L.polyline(
          segment.map((p) => [p.lat, p.lon]),
          { color, weight, interactive: false }
        ).addTo(trackLayer);
      }
    },

    clearTrack() {
      trackLayer.clearLayers();
    },

    /**
     * Report the bearing from the boat to the pointer, for driving the sight
     * line on a machine with no compass.
     *
     * Demo scaffolding, deliberately kept behind a caller that only wires it
     * up under a URL flag — but it lives here because it is Leaflet that
     * turns a pointer event into a coordinate, and nothing outside this file
     * is allowed to know that.
     *
     * `mousemove` only, not `touchstart`: on a touch device the compass is
     * the real source, and claiming the same gestures the map pans with
     * would break it for the case this is only standing in for.
     */
    onPointerBearing(handler) {
      map.on('mousemove', (e) => {
        if (!lastPosition) return;
        handler(initialBearing(lastPosition, { lat: e.latlng.lat, lon: e.latlng.lng }));
      });
    },

    setFollow(value) {
      following = value;
      onFollowChange?.(value);
      if (value && positionMarker) map.panTo(positionMarker.getLatLng());
    },

    /**
     * Zoom to fit a set of coordinates — a saved track, or the active route.
     *
     * `maxZoom` matters for the degenerate cases: a single waypoint, or a
     * course whose points all share a position, collapses to zero-size bounds
     * and would otherwise slam to maximum zoom.
     */
    fitPoints(points, { maxZoom = 16, clearControls = false } = {}) {
      const latlngs = points.map((p) => [p.lat, p.lon]);
      if (latlngs.length === 0) return;

      // The overlay buttons sit over the bottom-right corner, and fitBounds
      // will happily place a waypoint underneath them. Padding that corner
      // harder keeps the framed content clear of them.
      map.fitBounds(L.latLngBounds(latlngs), {
        maxZoom,
        paddingTopLeft: [40, 40],
        paddingBottomRight: clearControls ? [80, 90] : [40, 40],
      });
    },

    /** Open a popup with DOM content, e.g. the waypoint actions menu. */
    openPopup(lat, lon, content) {
      L.popup({ closeButton: true, autoPan: true, className: 'wp-popup' })
        .setLatLng([lat, lon])
        .setContent(content)
        .openOn(map);
    },

    closePopup() {
      map.closePopup();
    },

    getZoom() {
      return map.getZoom();
    },

    onZoom(handler) {
      map.on('zoomend', handler);
    },

    invalidateSize() {
      map.invalidateSize();
    },
  };
}
