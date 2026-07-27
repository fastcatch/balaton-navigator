/**
 * Derived performance figures for the data page: how well the boat is doing
 * against the target, as opposed to which target it is.
 *
 * Pure module: no DOM, no browser APIs, no I/O.
 *
 * `navigation.js` owns which waypoint is the target and whether we have
 * arrived. That code decides whether a route advances and is tested as such;
 * performance figures have no business sharing its surface, which is why
 * this is a separate module rather than a wider `computeNav`.
 *
 * Every field is null when its inputs are missing. Nothing here returns a
 * zero standing in for "unknown" — the panels draw an em dash for null, and
 * a plausible-looking zero would be read as a measurement.
 */

import { haversine, crossTrackDistance, relativeBearing } from './geo.js';

const toRad = (deg) => (deg * Math.PI) / 180;

const EMPTY = {
  sogMps: null,
  vmcMps: null,
  ttgSeconds: null,
  xteM: null,
  remainingM: null,
};

/** Sum of the legs beyond the target, which the boat has yet to start. */
function legsAhead(waypoints, targetIndex) {
  let total = 0;
  for (let i = targetIndex; i < waypoints.length - 1; i++) {
    total += haversine(waypoints[i], waypoints[i + 1]);
  }
  return total;
}

export function computeInstruments({ position, route, targetIndex, nav, cog, sogMps }) {
  // Speed over ground is the one figure that needs no route at all, so it is
  // filled in before anything can return early.
  const result = { ...EMPTY, sogMps: sogMps ?? null };

  const waypoints = route && Array.isArray(route.waypoints) ? route.waypoints : [];
  if (!nav?.hasTarget || nav.distance == null) return result;

  result.remainingM = nav.distance + legsAhead(waypoints, targetIndex);

  // The rhumb line needs a point behind us, and the first leg has none.
  // Substituting where the route was activated was considered and rejected:
  // XTE would then quietly mean two different things depending on the leg,
  // with nothing on screen saying which.
  if (targetIndex >= 1 && position) {
    result.xteM = crossTrackDistance(
      waypoints[targetIndex - 1],
      waypoints[targetIndex],
      position
    );
  }

  // VMC needs a direction of travel as well as a speed. Mid-tack, and below
  // about a knot, the GPS has no course to give and there is no honest
  // answer here either.
  if (result.sogMps != null && cog?.cog != null) {
    result.vmcMps = result.sogMps * Math.cos(toRad(relativeBearing(nav.bearing, cog.cog)));

    // Sailing away from the mark has no arrival time: zero would divide to
    // infinity and a negative would give a time in the past.
    if (result.vmcMps > 0) result.ttgSeconds = nav.distance / result.vmcMps;
  }

  return result;
}
