/**
 * Device compass heading.
 *
 * Entirely optional. When unavailable the app loses only the relative-bearing
 * arrow; the bearing and distance numbers are unaffected (spec 8).
 *
 * iOS requires `DeviceOrientationEvent.requestPermission()` to be called from
 * a user gesture, which is why this cannot be started automatically.
 */

import { magneticToTrue } from './core/geo.js';

/**
 * Magnetic declination at Lake Balaton, in degrees east, epoch 2026.
 *
 * Applied to EVERY heading source, because they are all magnetic:
 *
 *   - iOS `webkitCompassHeading` is documented as relative to magnetic north.
 *   - The `alpha` fallback on an absolute-orientation event is derived from
 *     the geomagnetic sensor, so also magnetic.
 *
 * Meanwhile every bearing this app computes from coordinates is true. The
 * two must be reconciled somewhere, and this is that place.
 *
 * The value drifts by roughly +0.1 deg/year in this region, so it is worth
 * re-checking every few years against a current model (for example
 * ngdc.noaa.gov/geomag/calculators/magcalc.shtml). Being a degree stale is
 * well inside GPS and compass noise; being five degrees stale is not.
 *
 * A single constant is enough: declination varies by about a tenth of a
 * degree across the whole lake, far below what the compass can resolve.
 */
const BALATON_DECLINATION_DEG = 5;

/** Whether this browser exposes device orientation at all. */
export function isCompassSupported() {
  return typeof DeviceOrientationEvent !== 'undefined';
}

/** Whether an explicit permission prompt is required (iOS 13+). */
export function compassNeedsPermission() {
  return typeof DeviceOrientationEvent?.requestPermission === 'function';
}

/**
 * Request compass permission. MUST be called from within a user gesture on
 * iOS, or it rejects regardless of what the user would have chosen.
 */
export async function requestCompassPermission() {
  if (!compassNeedsPermission()) return isCompassSupported();
  try {
    return (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Start reporting heading in degrees clockwise from TRUE north.
 * Returns a `stop()` function.
 *
 * Two sources, in order of trust:
 *   1. `webkitCompassHeading` — iOS only, non-standard, tilt-compensated.
 *   2. `alpha` on an absolute-orientation event. Relative-orientation events
 *      are ignored: their zero point is wherever the device happened to be
 *      when it started, which is worse than showing no direction at all.
 *
 * Both report magnetic north, so both are converted here. Callers receive
 * true bearings and never need to know which source produced them.
 */
export function watchHeading({ onHeading }) {
  if (!isCompassSupported()) return () => {};

  const report = (magnetic) => onHeading(magneticToTrue(magnetic, BALATON_DECLINATION_DEG));

  const handler = (event) => {
    if (typeof event.webkitCompassHeading === 'number') {
      report(event.webkitCompassHeading);
      return;
    }
    if (event.absolute === true && typeof event.alpha === 'number') {
      // alpha counts anticlockwise from north; compass bearings run clockwise.
      report((360 - event.alpha) % 360);
    }
  };

  window.addEventListener('deviceorientation', handler, true);
  return () => window.removeEventListener('deviceorientation', handler, true);
}
