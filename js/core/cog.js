/**
 * Course over ground, derived from GPS fixes alone.
 *
 * Pure module: no DOM, no browser APIs, no I/O. This is what the turn
 * indicator steers by, so it is kept testable without a browser.
 *
 * Why not the compass: a phone lying in a cockpit points wherever it was put,
 * so its magnetometer answers "which way is the phone facing", not "which way
 * is the boat going". Reading it requires aligning the phone with the boat's
 * axis, which is exactly what is impractical while racing. COG needs no
 * alignment, no calibration, and is not disturbed by a winch handle.
 */

import { haversine, initialBearing } from './geo.js';

/**
 * Speed below which GPS cannot extrapolate a direction of travel.
 *
 * Marine receivers report nonsense below roughly 0.75 kn for this reason.
 * 0.5 m/s is a shade under 1 kn, which on a becalmed lake is the difference
 * between a course and a random number.
 */
export const MIN_SPEED_MPS = 0.5;

/**
 * Circular spread above which the legs disagree too much to steer by.
 *
 * Covers both ways this goes wrong at once — a turn in progress, and GPS
 * noise from any cause — without needing a separate rule for each. A steady
 * course yields 2-4 degrees; mid-tack yields 30 or more.
 */
export const MAX_STEADY_SPREAD_DEG = 15;

/** A fix older than this is not evidence of where the boat is going now. */
export const STALE_MS = 15000;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

const NO_FIX = { cog: null, spreadDeg: null, status: 'nofix' };
const TOO_SLOW = { cog: null, spreadDeg: null, status: 'slow' };

/**
 * One leg between consecutive fixes.
 *
 * Course prefers the device's own `heading`: on most chipsets it is derived
 * from Doppler shift, which is more accurate than differencing two positions
 * that each carry metres of error. Weight is always distance travelled,
 * whichever source the course came from.
 */
function toLeg(a, b) {
  const dt = b.t - a.t;
  // Duplicate or out-of-order timestamps would divide by zero below.
  if (!(dt > 0)) return null;

  return {
    distance: haversine(a, b),
    dt,
    t: b.t,
    course: Number.isFinite(b.heading) ? b.heading : initialBearing(a, b),
  };
}

/**
 * Damped course over ground, with a figure for how much the legs agreed.
 *
 * `windowMs` of 0 means no damping: the newest leg is reported as it stands.
 */
export function computeCog(samples, { windowMs, minSpeedMps = MIN_SPEED_MPS, nowT }) {
  if (!Array.isArray(samples) || samples.length < 2) return { ...NO_FIX };
  if (nowT - samples[samples.length - 1].t > STALE_MS) return { ...NO_FIX };

  const legs = [];
  for (let i = 1; i < samples.length; i++) {
    const leg = toLeg(samples[i - 1], samples[i]);
    if (leg) legs.push(leg);
  }
  if (legs.length === 0) return { ...NO_FIX };

  const used = windowMs > 0 ? legs.filter((leg) => leg.t >= nowT - windowMs) : legs.slice(-1);
  if (used.length === 0) return { ...NO_FIX };

  // Sum as unit vectors weighted by distance travelled. Vector averaging is
  // not optional: a scalar mean of 359, 1 and 3 degrees gives 121. Weighting
  // by distance makes the filter self-gating, because a boat sitting still
  // contributes almost no weight and so cannot drown out real travel.
  let weight = 0;
  let seconds = 0;
  let x = 0;
  let y = 0;
  for (const leg of used) {
    weight += leg.distance;
    seconds += leg.dt / 1000;
    x += leg.distance * Math.sin(toRad(leg.course));
    y += leg.distance * Math.cos(toRad(leg.course));
  }

  if (weight === 0 || seconds === 0 || weight / seconds < minSpeedMps) return { ...TOO_SLOW };

  // Resultant length: 1 when every leg agreed, falling towards 0 as they
  // diverge. Converted to a circular standard deviation, because degrees of
  // spread can be reasoned about and a bare ratio cannot.
  const r = Math.min(1, Math.hypot(x, y) / weight);
  const spreadDeg = r >= 1 ? 0 : toDeg(Math.sqrt(-2 * Math.log(r)));

  return {
    cog: (toDeg(Math.atan2(x, y)) + 360) % 360,
    spreadDeg,
    status: spreadDeg > MAX_STEADY_SPREAD_DEG ? 'unsteady' : 'ok',
  };
}
