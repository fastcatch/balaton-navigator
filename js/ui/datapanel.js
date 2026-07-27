/**
 * The data page: the figures that are buried in the boat's own instruments,
 * or absent from them for lack of GPS.
 *
 * Same register as navpanel.js — large, high contrast, readable at arm's
 * length in glare. Nothing here is a button, so unlike the list views this
 * panel can be rebuilt on every fix without pulling a tap target out from
 * under a finger.
 */

import { el, figure, replace } from './dom.js';
import { formatBearing, formatDistance, formatDuration, formatSpeed } from '../core/geo.js';

/** An em dash, never a zero: a missing figure must not read as a measurement. */
const NONE = '—';

/** The subordinate row, drawn smaller than the three figures above it. */
const smallFigure = (label, value) => figure(label, value, { valueClass: 'data-small' });

/**
 * Cross-track error, with the arrow pointing the way to steer back.
 *
 * `crossTrackDistance` is positive when the boat is to starboard of the
 * track, so the correction is to port: the arrow is the opposite of the side
 * you are on. Getting that backwards fails silently — the number stays
 * right and the helm goes the wrong way — hence spelling it out here.
 */
function xteText(xteM, units) {
  if (xteM == null) return NONE;
  return `${xteM > 0 ? '◀' : '▶'} ${formatDistance(Math.abs(xteM), units)}`;
}

export function renderDataPanel(container, { instruments, cog, settings }) {
  const { sogMps, vmcMps, xteM, remainingM } = instruments;
  const units = settings.units;

  return replace(container, [
    el('div', { className: 'nav-grid' }, [
      figure('SOG', sogMps == null ? NONE : formatSpeed(sogMps, units)),
      figure('VMC', vmcMps == null ? NONE : formatSpeed(vmcMps, units)),
    ]),
    el('div', { className: 'nav-grid' }, [
      figure('COG', cog.cog == null ? NONE : formatBearing(cog.cog)),
    ]),
    el('div', { className: 'nav-grid' }, [
      smallFigure('XTE', xteText(xteM, units)),
      smallFigure('Hátra', remainingM == null ? NONE : formatDistance(remainingM, units)),
    ]),
  ]);
}
