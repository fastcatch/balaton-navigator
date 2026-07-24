/**
 * GPS position watching.
 *
 * Wraps `navigator.geolocation.watchPosition` and normalises what it reports
 * into the plain `{ lat, lon, accuracy, speed, heading, t }` shape the pure
 * core expects.
 */

/** Distinguishable failure states, so the UI can say something useful. */
export const POSITION_ERROR = {
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
  UNSUPPORTED: 'unsupported',
};

const WATCH_OPTIONS = {
  enableHighAccuracy: true, // a boat needs metres, not a cell-tower fix
  maximumAge: 0,
  timeout: 30000,
};

function normalise(geoPosition) {
  const c = geoPosition.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy ?? null,
    // `speed` and `heading` are null unless the device is actually moving.
    speed: Number.isFinite(c.speed) ? c.speed : null,
    heading: Number.isFinite(c.heading) ? c.heading : null,
    t: geoPosition.timestamp,
  };
}

function translateError(err) {
  if (err.code === err.PERMISSION_DENIED) return POSITION_ERROR.DENIED;
  if (err.code === err.POSITION_UNAVAILABLE) return POSITION_ERROR.UNAVAILABLE;
  if (err.code === err.TIMEOUT) return POSITION_ERROR.TIMEOUT;
  return POSITION_ERROR.UNAVAILABLE;
}

/**
 * Start watching position. Returns a `stop()` function.
 *
 * `onError` is called with a POSITION_ERROR value. A timeout is not fatal —
 * the watch stays live and may recover when the sky opens up.
 */
export function watchPosition({ onPosition, onError }) {
  if (!navigator.geolocation) {
    onError?.(POSITION_ERROR.UNSUPPORTED);
    return () => {};
  }

  const id = navigator.geolocation.watchPosition(
    (p) => onPosition(normalise(p)),
    (e) => onError?.(translateError(e)),
    WATCH_OPTIONS
  );

  return () => navigator.geolocation.clearWatch(id);
}
