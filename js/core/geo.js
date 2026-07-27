/**
 * Great-circle geometry and display formatting.
 *
 * Pure module: no DOM, no browser APIs, no I/O. Everything here runs
 * unchanged under `node --test`, which is deliberate — this is the code that
 * decides which way the boat points, so it must be testable without a browser.
 *
 * All bearings are TRUE, not magnetic.
 */

/** Mean Earth radius, the value the reference formulas are stated against. */
export const EARTH_RADIUS_M = 6371000;

/** Metres in a nautical mile (exact, by definition). */
export const METRES_PER_NM = 1852;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Great-circle distance in metres (haversine).
 *
 * Chosen over the spherical law of cosines because it stays numerically
 * stable at the small separations this app spends most of its time in —
 * a boat metres from a waypoint.
 */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial great-circle bearing from `a` to `b`, in degrees clockwise from
 * true north, normalised to [0, 360).
 *
 * "Initial" matters: a great circle changes bearing along its length. At
 * Balaton's scale the change is far below display resolution, but the
 * correct formula costs nothing.
 */
export function initialBearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * The point reached by travelling `distanceM` from `from` along a great
 * circle on the given true bearing.
 *
 * Used to draw the heading ray out past the edge of the map, so the line
 * shows what lies ahead rather than stopping at an arbitrary length.
 */
export function destinationPoint(from, bearingDeg, distanceM) {
  const delta = distanceM / EARTH_RADIUS_M; // angular distance
  const theta = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)));

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * sinLat2
    );

  return {
    lat: toDeg(lat2),
    // Normalise to -180..180: an unwrapped longitude would make Leaflet draw
    // the line the long way round the globe.
    lon: (((toDeg(lon2) + 540) % 360) - 180),
  };
}

/**
 * Signed perpendicular distance in metres from `p` to the great circle
 * through `from` and `to`. Positive means `p` lies to starboard of the track.
 *
 * The circle is deliberately not clipped to the segment. Past the target the
 * value keeps reading as distance from the intended track extended onward,
 * which is what a boat overstanding a mark needs to see; clipping would
 * collapse it to zero exactly when the error is worth knowing.
 */
export function crossTrackDistance(from, to, p) {
  const delta13 = haversine(from, p) / EARTH_RADIUS_M;
  const theta13 = toRad(initialBearing(from, p));
  const theta12 = toRad(initialBearing(from, to));

  const sin = Math.sin(delta13) * Math.sin(theta13 - theta12);
  // Clamp before asin: rounding can push the product a hair outside [-1, 1]
  // and NaN would propagate silently into the readout.
  return Math.asin(Math.max(-1, Math.min(1, sin))) * EARTH_RADIUS_M;
}

/**
 * Convert a magnetic compass heading to a true bearing.
 *
 * Declination is positive east: it is the angle from true north round to
 * magnetic north, so a magnetic reading plus the declination gives true.
 *
 * This conversion is not optional. Every bearing this app computes from
 * coordinates is true, and every heading the device reports is magnetic;
 * without it the compass arrow, the view cone and the sight line are all
 * consistently wrong by the local declination.
 */
export function magneticToTrue(magneticDeg, declinationDeg) {
  return ((magneticDeg + declinationDeg) % 360 + 360) % 360;
}

/**
 * Bearing to the target relative to where the boat is pointing, in
 * (-180, 180]. Negative is to port, positive to starboard.
 *
 * This is what the on-screen arrow renders: turn until it points up.
 */
export function relativeBearing(targetBearing, heading) {
  let rel = (targetBearing - heading) % 360;
  if (rel > 180) rel -= 360;
  if (rel <= -180) rel += 360;
  return rel;
}

/**
 * Format a distance for the navigation panel.
 *
 * Resolves the spec's contradiction between section 6.2 (metric format) and
 * section 6.4 (nautical toggle) into one rule driven by the setting.
 */
export function formatDistance(metres, units = 'metric') {
  if (units === 'nautical') {
    const nm = metres / METRES_PER_NM;
    // Below half a mile, metres are easier to act on than a decimal fraction.
    if (nm < 0.5) return `${Math.round(metres)} m`;
    return `${nm.toFixed(2)} NM`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/** Format a bearing as three zero-padded degrees, e.g. `047°`. */
export function formatBearing(deg) {
  // Round first, then wrap: 359.7 must render as 000, not 360.
  const whole = Math.round(deg) % 360;
  return `${String((whole + 360) % 360).padStart(3, '0')}°`;
}

/**
 * Format a speed for the readouts, following the same unit setting as
 * distance.
 *
 * The minus sign is U+2212, not a hyphen: at forty pixels a hyphen is short
 * enough to read as a dash, and VMC on a losing tack must be unmistakably
 * negative.
 */
export function formatSpeed(mps, units = 'metric') {
  const value = units === 'nautical' ? (mps * 3600) / METRES_PER_NM : mps * 3.6;
  const unit = units === 'nautical' ? 'kn' : 'km/h';
  return `${value.toFixed(1).replace('-', '−')} ${unit}`;
}

/**
 * Format a duration as `h:mm`.
 *
 * Capped at `9:59+`. Becalmed, VMC falls towards zero and the quotient runs
 * to tens of hours — a figure both too wide for the column and a fiction,
 * since VMC will not hold that long. The cap stays distinguishable from the
 * em dash the panels draw when there is no data at all.
 */
export function formatDuration(seconds) {
  // Round to minutes first. Rounding after the cap test would let 9:59:59
  // through and then print it as "10:00".
  const minutes = Math.round(seconds / 60);
  if (minutes >= 600) return '9:59+';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Project a point to local planar metres relative to an origin.
 *
 * Equirectangular approximation. Valid because it is only ever used to
 * measure deviations of a few hundred metres inside `simplify`.
 */
function toLocalXY(p, origin, cosLat) {
  return {
    x: toRad(p.lon - origin.lon) * cosLat * EARTH_RADIUS_M,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/** Perpendicular distance in metres from `p` to the segment `a`-`b`. */
function perpendicularDistance(p, a, b) {
  const cosLat = Math.cos(toRad(a.lat));
  const pa = toLocalXY(p, a, cosLat);
  const ba = toLocalXY(b, a, cosLat);

  const lenSq = ba.x * ba.x + ba.y * ba.y;
  if (lenSq === 0) return Math.hypot(pa.x, pa.y);

  // Clamp to the segment so a point beyond an endpoint measures to that
  // endpoint rather than to the infinite line.
  let t = (pa.x * ba.x + pa.y * ba.y) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(pa.x - t * ba.x, pa.y - t * ba.y);
}

/**
 * Douglas-Peucker line simplification. Returns a subset of `points` with
 * every discarded point lying within `epsilonMetres` of the kept line.
 *
 * Spec section 8 suggests keeping every Nth point instead. That flattens
 * exactly the tacking corners a sailor wants to see; this preserves them
 * for the same implementation cost. Raw track data is never simplified —
 * only what gets drawn.
 *
 * Iterative rather than recursive: a multi-hour track can be tens of
 * thousands of points, and deep recursion would risk the stack.
 */
export function simplify(points, epsilonMetres) {
  if (points.length <= 2) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;

    let maxDist = 0;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }

    if (maxDist > epsilonMetres && maxIndex !== -1) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}
