/**
 * The navigation readout: bearing, distance, target, and the relative-bearing
 * arrow when a heading is known.
 *
 * This is the one part of the UI that has to be readable at arm's length in
 * glare, so it is deliberately sparse.
 */

import { el, replace } from './dom.js';
import { formatBearing, formatDistance, relativeBearing } from '../core/geo.js';

const figure = (label, value) =>
  el('div', { className: 'nav-figure' }, [
    el('div', { className: 'nav-label', textContent: label }),
    el('div', { className: 'nav-value', textContent: value }),
  ]);

export function renderNavPanel(container, { nav, heading, settings }) {
  // Nothing to steer towards. Say so plainly rather than showing zeroes,
  // which would read as a real bearing (spec 8).
  if (nav.routeComplete) {
    return replace(container, el('div', { className: 'nav-message', textContent: '⚑ Cél elérve' }));
  }
  if (!nav.hasTarget) {
    return replace(container, el('div', { className: 'nav-message', textContent: 'Nincs kijelölt cél' }));
  }
  if (nav.distance == null) {
    return replace(container, [
      el('div', { className: 'nav-message', textContent: 'Várakozás GPS-jelre…' }),
      el('div', { className: 'nav-target', textContent: `Cél: ${nav.targetName}` }),
    ]);
  }

  const children = [
    figure('Irányszög', formatBearing(nav.bearing)),
    figure('Távolság', formatDistance(nav.distance, settings.units)),
  ];

  // The arrow only appears when the heading was actually measured. Without a
  // compass the numbers stand alone, which the spec explicitly allows.
  if (heading != null) {
    const rel = relativeBearing(nav.bearing, heading);
    children.push(
      el('div', { className: 'nav-arrow', title: 'Fordulj, amíg a nyíl felfelé mutat' }, [
        el('span', { textContent: '➤', style: `transform: rotate(${rel - 90}deg)` }),
      ])
    );
  } else {
    children.push(el('div'));
  }

  const grid = el('div', { className: 'nav-grid' }, [
    children[0],
    children[1],
    children[2],
    el('div', { className: 'nav-target', textContent: `Cél: ${nav.targetName}` }),
  ]);

  return replace(container, grid);
}
