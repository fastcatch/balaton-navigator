/**
 * Navigation state: which waypoint is the target, how far, which way, and
 * when to move on.
 *
 * Pure module: no DOM, no browser APIs, no I/O. This is the code that decides
 * which direction the boat is told to go, so it is kept free of the platform
 * and tested directly.
 */

import { haversine, initialBearing } from './geo.js';

/**
 * How poor a fix may be and still be trusted to confirm arrival, as a
 * multiple of the arrival radius.
 *
 * The spec (6.2) advances on proximity alone. That is unsafe: a 200 m
 * accuracy fix is "within 30 m" of several waypoints at once, so a squall or
 * a bridge could skip half a route. Requiring the fix to be at least twice as
 * precise as the radius makes the claim meaningful.
 */
const ACCURACY_GUARD_FACTOR = 2;

const EMPTY = {
  hasTarget: false,
  targetIndex: null,
  targetName: null,
  bearing: null,
  distance: null,
  arrived: false,
  routeComplete: false,
  accuracyOk: true,
};

/** True if `route` holds at least one waypoint. */
function waypointsOf(route) {
  return route && Array.isArray(route.waypoints) ? route.waypoints : [];
}

/**
 * Whether a fix is precise enough to confirm arrival within `radius`.
 *
 * A fix reporting no accuracy at all is trusted: some devices omit it, and
 * refusing to ever advance would be a worse failure than trusting a fix we
 * have no specific reason to doubt.
 */
function isAccuracyUsable(position, radius) {
  if (position?.accuracy == null) return true;
  return position.accuracy < radius * ACCURACY_GUARD_FACTOR;
}

/**
 * Derive everything the navigation panel and map need for one render.
 *
 * `targetIndex` is supplied by the caller and never second-guessed here —
 * that is what makes manual target selection (tapping a waypoint) work.
 */
export function computeNav(position, route, targetIndex, settings) {
  const waypoints = waypointsOf(route);
  if (waypoints.length === 0) return { ...EMPTY };

  // Past the end: the route is finished, not broken.
  if (targetIndex >= waypoints.length) {
    return { ...EMPTY, routeComplete: true };
  }
  if (targetIndex < 0) return { ...EMPTY };

  const target = waypoints[targetIndex];
  const base = {
    ...EMPTY,
    hasTarget: true,
    targetIndex,
    targetName: target.name,
  };

  // A target without a fix is a legitimate state: the user has planned a
  // route indoors, or GPS permission is denied. Show the target, not an error.
  if (!position) return base;

  const radius = settings.arrivalRadiusM;
  const accuracyOk = isAccuracyUsable(position, radius);
  const distance = haversine(position, target);

  return {
    ...base,
    bearing: initialBearing(position, target),
    distance,
    accuracyOk,
    arrived: distance < radius && accuracyOk,
  };
}

/**
 * The target index after this fix — unchanged, or advanced by exactly one.
 *
 * Advancing is monotonic and at most one step per fix, so sailing back over
 * an earlier waypoint cannot rewind the route.
 */
export function advanceIfArrived(position, route, targetIndex, settings) {
  const nav = computeNav(position, route, targetIndex, settings);
  return nav.arrived ? targetIndex + 1 : targetIndex;
}
