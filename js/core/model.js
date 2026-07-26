/**
 * Entity factories, defaults, and input validation.
 *
 * Pure module: no DOM, no storage. `crypto.randomUUID` is available both in
 * Safari 15.4+ and in Node, so it is not a platform dependency in practice.
 */

/**
 * Bounding box enclosing Lake Balaton with a margin for approaches and
 * harbours. Used only to warn about likely typos, never to reject.
 */
export const BALATON_BOUNDS = {
  south: 46.6,
  north: 47.15,
  west: 17.1,
  east: 18.2,
};

export const createId = () => crypto.randomUUID();

const pad = (n) => String(n).padStart(2, '0');

/** `2026-07-24 14:05` in local time — the user's clock, not UTC. */
function formatLocalStamp(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `WP1`, `WP2`, ... from a zero-based index (spec 6.1). */
export const defaultWaypointName = (index) => `WP${index + 1}`;

export const defaultRouteName = (at = new Date()) => `Útvonal ${formatLocalStamp(at)}`;

export const defaultTrackName = (at = new Date()) => formatLocalStamp(at);

export function defaultSettings() {
  return {
    units: 'metric',
    arrivalRadiusM: 30, // spec 6.4
    minAccuracyM: 50, // spec 6.3
    keepAwake: true,
    // Seconds of GPS history averaged into the course over ground. Racing
    // means frequent course changes, so this sits at the low end of what
    // marine practice suggests; 0 disables damping entirely.
    cogDampingS: 5,
  };
}

export function createWaypoint({ name, lat, lon }) {
  // No `order` field: position within Route.waypoints is the single source of
  // truth. Two sources would drift the first time a reorder is interrupted.
  return { id: createId(), name, lat, lon };
}

export function createRoute({ name } = {}) {
  const now = Date.now();
  return {
    id: createId(),
    name: name ?? defaultRouteName(),
    waypoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createTrack({ name, routeId } = {}) {
  return {
    id: createId(),
    name: name ?? defaultTrackName(),
    points: [],
    pointCount: 0,
    startedAt: Date.now(),
    endedAt: null,
    routeId: routeId ?? null,
  };
}

/**
 * Parse one typed coordinate to a number, or null if it is not one.
 *
 * Accepts a decimal comma: Hungarian keyboards produce one, and rejecting it
 * would look like a bug to the person this app is for.
 */
export function parseCoordinate(input) {
  if (typeof input !== 'string') return null;

  const cleaned = input.trim().replace(',', '.').replace(/°\s*$/, '').trim();
  if (cleaned === '') return null;

  // Reject anything that is not exactly one signed decimal number, so that
  // "46.9.48" fails rather than silently parsing as 46.9.
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const inBalaton = (lat, lon) =>
  lat >= BALATON_BOUNDS.south &&
  lat <= BALATON_BOUNDS.north &&
  lon >= BALATON_BOUNDS.west &&
  lon <= BALATON_BOUNDS.east;

/**
 * Validate a typed latitude/longitude pair (spec 6.1, manual entry).
 *
 * Coordinates outside Balaton are accepted with a warning rather than
 * rejected: the user may legitimately plan elsewhere, but a digit typo is
 * more likely and should not pass silently.
 */
export function validateCoordinates(latInput, lonInput) {
  const lat = parseCoordinate(latInput);
  const lon = parseCoordinate(lonInput);

  if (lat === null) {
    return { ok: false, error: 'A szélesség nem értelmezhető szám (pl. 46.9483).' };
  }
  if (lon === null) {
    return { ok: false, error: 'A hosszúság nem értelmezhető szám (pl. 17.8869).' };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: 'A szélesség -90 és 90 fok közé kell essen.' };
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, error: 'A hosszúság -180 és 180 fok közé kell essen.' };
  }

  return {
    ok: true,
    lat,
    lon,
    error: null,
    warning: inBalaton(lat, lon)
      ? null
      : 'Ez a pont a Balatontól távol esik – biztosan jó a koordináta?',
  };
}
