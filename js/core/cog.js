/**
 * Motion over ground — course and speed — derived from GPS fixes alone.
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

/**
 * Mean speed over ground in m/s across the damping window, or null.
 *
 * Prefers the fixes' own `speed`, which on most chipsets is Doppler-derived
 * and so does not inherit the metres of error each position carries. Falls
 * back to distance over time when no fix in the window reports one: some
 * devices populate `speed` only while moving briskly.
 *
 * Windows by consecutive pair: a pair is included if its LATER sample lies
 * inside the window, mirroring how computeCog filters legs. This prevents
 * disagreement when a fix gap exceeds windowMs — both functions remain silent
 * together or report together, rather than one reporting while the other
 * goes blank.
 *
 * Lives here rather than beside the other derived figures because the
 * staleness rule and the meaning of `windowMs` already live in this module,
 * and two copies of those is how the course and the speed come to disagree.
 */
export function computeSog(samples, { windowMs, nowT }) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  if (nowT - samples[samples.length - 1].t > STALE_MS) return null;

  // Build pairs WITHOUT their distance yet. Most fixes report `speed`, so the
  // Doppler branch below is the common case and never reads it — computing a
  // haversine for every pair up front, only to discard the answer every time
  // the device reports speed, was 14 wasted calls per render for nothing.
  const pairs = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    // Duplicate or out-of-order timestamps would divide by zero below.
    if (!(dt > 0)) continue;
    pairs.push({
      a: samples[i - 1],
      b: samples[i],
      dt,
      t: samples[i].t, // Filter by the later sample's timestamp
    });
  }
  if (pairs.length === 0) return null;

  // Filter pairs by the later sample's timestamp, matching computeCog's leg filtering.
  // `windowMs` of 0 means no damping: the newest pair only.
  const used = windowMs > 0 ? pairs.filter((pair) => pair.t >= nowT - windowMs) : pairs.slice(-1);
  if (used.length === 0) return null;

  // Collect all samples participating in used pairs, in temporal order.
  const seen = new Set();
  const participating = [];
  for (const pair of used) {
    if (!seen.has(pair.a)) {
      seen.add(pair.a);
      participating.push(pair.a);
    }
    if (!seen.has(pair.b)) {
      seen.add(pair.b);
      participating.push(pair.b);
    }
  }
  participating.sort((a, b) => a.t - b.t);

  // Prefer device speeds from participating samples. The normal case, and the
  // one that never needs a single haversine.
  const reported = participating.filter((s) => Number.isFinite(s.speed));
  if (reported.length > 0) {
    return reported.reduce((sum, s) => sum + s.speed, 0) / reported.length;
  }

  // Fall back to distance over time across used pairs — the only branch that
  // actually reads a distance, so it is the only branch that computes one.
  let distance = 0;
  for (const pair of used) {
    distance += haversine(pair.a, pair.b);
  }
  const seconds = (participating[participating.length - 1].t - participating[0].t) / 1000;
  return seconds > 0 ? distance / seconds : null;
}

/**
 * Error below which the boat counts as on course.
 *
 * The panel draws an up arrow rather than a side, so a boat holding its line
 * does not flicker between port and starboard chevrons on GPS noise alone.
 */
export const ON_COURSE_DEG = 3;

/**
 * Step-up and step-down thresholds for the chevron bands.
 *
 * The gap between `up` and `down` is hysteresis. Without it, an error sitting
 * on 10 degrees would switch between one and two chevrons several times a
 * second, which reads as a fault rather than as a number.
 */
const BANDS = [
  { up: 10, down: 8 },
  { up: 25, down: 23 },
];

/**
 * Coarse GPS fix quality for the header dot: accuracy banded, but only for a
 * fix that is still current.
 *
 * `computeCog` and `computeSog` both go silent — decaying to em dashes —
 * once a fix is older than `STALE_MS`. Without checking age here too, the
 * dot stayed solid green through that whole decay, supplying a confident
 * "GPS is fine" explanation for numbers that were actually going blank for
 * lack of one. Reusing `STALE_MS` rather than a second constant is what
 * keeps the dot and the filters unable to disagree about when a fix stops
 * counting.
 *
 * Pure and age-aware rather than clock-reading: the caller passes `nowT` so
 * a render only reads `Date.now()` once, the same instant `computeCog` and
 * `computeSog` are judged against.
 */
export function gpsFixQuality(position, nowT, { goodAccuracyM, poorAccuracyM }) {
  if (!position) return 'none';
  if (nowT - position.t > STALE_MS) return 'none';
  if (position.accuracy == null) return 'fair';
  if (position.accuracy <= goodAccuracyM) return 'good';
  if (position.accuracy <= poorAccuracyM) return 'fair';
  return 'poor';
}

/**
 * How many chevrons to draw for a turn of `absDeg`: 0 (on course) to 3.
 *
 * Stateless — the caller passes back what was drawn last time, which is what
 * makes the hysteresis work without this module holding state.
 */
export function chevronCount(absDeg, previousCount = 0) {
  if (absDeg < ON_COURSE_DEG) return 0;

  let count = 1;
  BANDS.forEach((band, i) => {
    const wasAbove = previousCount >= i + 2;
    if (wasAbove ? absDeg > band.down : absDeg >= band.up) count = i + 2;
  });
  return count;
}
