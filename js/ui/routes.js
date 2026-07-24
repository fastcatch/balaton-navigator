/**
 * Route and waypoint management (spec 6.1).
 *
 * One screen holds both the active route's waypoints and the list of saved
 * routes, so there is no drilling down. Reordering uses up/down buttons
 * rather than drag-and-drop: the spec permits either, and dragging fights
 * with map panning and is unreliable with wet hands.
 */

import { el, iconButton, empty } from './dom.js';
import { haversine, initialBearing, formatBearing, formatDistance } from '../core/geo.js';
import { validateCoordinates } from '../core/model.js';

/** Leg summary shown under each waypoint: distance and bearing from the previous one. */
function legSummary(waypoints, index, units) {
  if (index === 0) return 'Indulás';
  const from = waypoints[index - 1];
  const to = waypoints[index];
  const distance = formatDistance(haversine(from, to), units);
  const bearing = formatBearing(initialBearing(from, to));
  return `${bearing} · ${distance}`;
}

function waypointRow(wp, index, waypoints, targetIndex, units, actions) {
  const isTarget = index === targetIndex;

  return el('li', { className: isTarget ? 'is-target' : '' }, [
    // The number badge already shows which waypoint is the target, so it is
    // also what sets it. This is the only way to reach a waypoint that shares
    // coordinates with another — a start and finish on the same line put two
    // markers exactly on top of each other, and the map can only ever hand
    // back whichever one is drawn on top.
    el('button', {
      className: 'num-button',
      type: 'button',
      ariaLabel: isTarget ? `${wp.name}: ez az aktuális cél` : `${wp.name} kijelölése célnak`,
      ariaPressed: String(isTarget),
      onClick: () => actions.onSetTarget(index),
    }, [
      el('div', { className: 'num', textContent: String(index + 1) }),
    ]),

    // The name is the rename control. A separate pencil button would cost a
    // fourth 48px target and squeeze the name down to a few characters.
    el('button', {
      className: 'grow row-button',
      type: 'button',
      onClick: () => actions.onRenameWaypoint(index),
    }, [
      el('div', { className: 'title-row' }, [
        el('span', { className: 'title', textContent: wp.name }),
        isTarget ? el('span', { className: 'chip', textContent: 'CÉL' }) : null,
      ]),
      el('div', { className: 'sub', textContent: legSummary(waypoints, index, units) }),
      // Coordinates get their own line: sharing one with the leg summary
      // truncated exactly the digits you check after typing them in.
      // Four decimals is ~11 m, finer than any waypoint needs to be shown.
      el('div', {
        className: 'sub',
        textContent: `${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}`,
      }),
    ]),

    iconButton('▲', () => actions.onMoveWaypoint(index, -1)),
    iconButton('▼', () => actions.onMoveWaypoint(index, 1)),
    iconButton('✕', () => actions.onDeleteWaypoint(index), 'icon-btn--danger'),
  ]);
}

/** Manual coordinate entry (spec 6.1), for known harbour positions. */
function coordinateForm(actions) {
  const lat = el('input', { type: 'text', inputMode: 'decimal', placeholder: '46.9483' });
  const lon = el('input', { type: 'text', inputMode: 'decimal', placeholder: '17.8869' });
  const name = el('input', { type: 'text', placeholder: 'Név (opcionális)' });
  const error = el('div', { className: 'form-error' });
  const warn = el('div', { className: 'form-warn' });

  const submit = () => {
    error.textContent = '';
    warn.textContent = '';

    const result = validateCoordinates(lat.value, lon.value);
    if (!result.ok) {
      error.textContent = result.error;
      return;
    }
    if (result.warning) warn.textContent = result.warning;

    actions.onAddCoordinate(result.lat, result.lon, name.value.trim() || null);
    lat.value = '';
    lon.value = '';
    name.value = '';
  };

  return el('div', {}, [
    el('div', { className: 'row' }, [
      el('div', { className: 'field' }, [el('label', { textContent: 'Szélesség (É)' }), lat]),
      el('div', { className: 'field' }, [el('label', { textContent: 'Hosszúság (K)' }), lon]),
    ]),
    el('div', { className: 'field' }, [el('label', { textContent: 'Név' }), name]),
    error,
    warn,
    el('button', { type: 'button', className: 'btn-primary', textContent: 'Waypoint hozzáadása', onClick: submit }),
  ]);
}

export function renderRoutesView({ routes, activeRoute, targetIndex, settings, actions }) {
  const nodes = [];

  // --- Active route -------------------------------------------------
  nodes.push(el('div', { className: 'section-title', textContent: 'Aktív útvonal' }));

  if (!activeRoute) {
    nodes.push(empty('Nincs aktív útvonal. Hozz létre egyet alább.'));
  } else {
    nodes.push(
      el('ul', { className: 'list' }, [
        el('li', {}, [
          el('div', { className: 'grow' }, [
            el('div', { className: 'title', textContent: activeRoute.name }),
            el('div', {
              className: 'sub',
              textContent: `${activeRoute.waypoints.length} waypoint`,
            }),
          ]),
          iconButton('✎', () => actions.onRenameRoute(activeRoute)),
        ]),
      ])
    );

    if (activeRoute.waypoints.length === 0) {
      nodes.push(empty('Még nincs waypoint. Koppints a térképre, vagy add meg a koordinátákat lent.'));
    } else {
      nodes.push(
        el(
          'ul',
          { className: 'list' },
          activeRoute.waypoints.map((wp, i) =>
            waypointRow(wp, i, activeRoute.waypoints, targetIndex, settings.units, actions)
          )
        )
      );
      nodes.push(
        el('div', {
          className: 'hint',
          textContent:
            'Célnak kijelölés: koppints a sorszámra itt, vagy a waypointra a térképen. ' +
            'A névre koppintva átnevezheted.',
          style: 'color:var(--parchment-dim);font-size:12px;margin:-8px 0 16px',
        })
      );
    }

    nodes.push(el('div', { className: 'section-title', textContent: 'Koordináta megadása kézzel' }));
    nodes.push(coordinateForm(actions));
  }

  // --- Saved routes -------------------------------------------------
  nodes.push(el('div', { className: 'section-title', textContent: 'Útvonalaim' }));

  if (routes.length === 0) {
    nodes.push(empty('Még nincs mentett útvonal.'));
  } else {
    nodes.push(
      el(
        'ul',
        { className: 'list' },
        routes.map((route) =>
          el('li', { className: route.id === activeRoute?.id ? 'is-active' : '' }, [
            el('button', {
              className: 'grow row-button',
              type: 'button',
              onClick: () => actions.onSelectRoute(route.id),
            }, [
              el('div', { className: 'title', textContent: route.name }),
              el('div', {
                className: 'sub',
                textContent: `${route.waypoints.length} waypoint · módosítva ${new Date(route.updatedAt).toLocaleDateString('hu-HU')}`,
              }),
            ]),
            iconButton('✕', () => actions.onDeleteRoute(route), 'icon-btn--danger'),
          ])
        )
      )
    );
  }

  nodes.push(
    el('button', { type: 'button', className: 'btn-primary', textContent: '+ Új útvonal', onClick: actions.onCreateRoute })
  );

  return nodes;
}
