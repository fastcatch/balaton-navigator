import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNav, advanceIfArrived } from '../js/core/navigation.js';
import { EARTH_RADIUS_M } from '../js/core/geo.js';

const SETTINGS = { units: 'metric', arrivalRadiusM: 30, minAccuracyM: 50 };

/** Degrees of latitude corresponding to `m` metres due north. */
const metresNorth = (m) => (m / (EARTH_RADIUS_M * Math.PI)) * 180;

const WP = (name, lat, lon) => ({ id: name, name, lat, lon });

const ROUTE = {
  id: 'r1',
  name: 'Teszt útvonal',
  waypoints: [
    WP('WP1', 46.9, 17.9),
    WP('WP2', 46.95, 17.95),
    WP('WP3', 47.0, 18.0),
  ],
};

/** A fix `m` metres due north of waypoint `i`. */
const fixNearWaypoint = (i, m, accuracy = 5) => ({
  lat: ROUTE.waypoints[i].lat + metresNorth(m),
  lon: ROUTE.waypoints[i].lon,
  accuracy,
});

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

test('a route with waypoints reports the indexed waypoint as the target', () => {
  const nav = computeNav(fixNearWaypoint(0, 5000), ROUTE, 0, SETTINGS);
  assert.equal(nav.hasTarget, true);
  assert.equal(nav.targetName, 'WP1');
  assert.equal(nav.targetIndex, 0);
  assert.equal(nav.routeComplete, false);
});

test('the target index is honoured as given, so manual override works', () => {
  // Tapping a waypoint sets the index directly; nothing here may override it.
  const nav = computeNav(fixNearWaypoint(0, 5000), ROUTE, 2, SETTINGS);
  assert.equal(nav.targetName, 'WP3');
  assert.equal(nav.targetIndex, 2);
});

test('an empty route reports no target rather than throwing', () => {
  const nav = computeNav(fixNearWaypoint(0, 100), { id: 'e', waypoints: [] }, 0, SETTINGS);
  assert.equal(nav.hasTarget, false);
  assert.equal(nav.targetName, null);
  assert.equal(nav.distance, null);
  assert.equal(nav.bearing, null);
  assert.equal(nav.routeComplete, false);
});

test('a null route reports no target rather than throwing', () => {
  const nav = computeNav(fixNearWaypoint(0, 100), null, 0, SETTINGS);
  assert.equal(nav.hasTarget, false);
  assert.equal(nav.targetName, null);
});

test('an index past the last waypoint reports the route as complete', () => {
  const nav = computeNav(fixNearWaypoint(2, 5), ROUTE, 3, SETTINGS);
  assert.equal(nav.routeComplete, true);
  assert.equal(nav.hasTarget, false);
  assert.equal(nav.distance, null);
});

// ---------------------------------------------------------------------------
// Behaviour without a position fix
// ---------------------------------------------------------------------------

test('with no position fix there is still a target but no bearing or distance', () => {
  const nav = computeNav(null, ROUTE, 1, SETTINGS);
  assert.equal(nav.hasTarget, true);
  assert.equal(nav.targetName, 'WP2');
  assert.equal(nav.bearing, null);
  assert.equal(nav.distance, null);
  assert.equal(nav.arrived, false);
});

// ---------------------------------------------------------------------------
// Bearing and distance
// ---------------------------------------------------------------------------

test('a fix due north of the target bears due south of it', () => {
  const nav = computeNav(fixNearWaypoint(0, 1000), ROUTE, 0, SETTINGS);
  assert.ok(Math.abs(nav.bearing - 180) < 0.001, `expected ~180, got ${nav.bearing}`);
  assert.ok(Math.abs(nav.distance - 1000) < 1, `expected ~1000 m, got ${nav.distance}`);
});

// ---------------------------------------------------------------------------
// Arrival — the accuracy guard is the point of these tests
// ---------------------------------------------------------------------------

test('a good fix inside the arrival radius counts as arrived', () => {
  const nav = computeNav(fixNearWaypoint(0, 10, 5), ROUTE, 0, SETTINGS);
  assert.equal(nav.arrived, true);
});

test('a good fix outside the arrival radius does not count as arrived', () => {
  const nav = computeNav(fixNearWaypoint(0, 100, 5), ROUTE, 0, SETTINGS);
  assert.equal(nav.arrived, false);
});

test('a poor fix inside the arrival radius does NOT count as arrived', () => {
  // A 200 m-accuracy fix says nothing about being within 30 m. Trusting it
  // would skip waypoints under bad signal.
  const nav = computeNav(fixNearWaypoint(0, 10, 200), ROUTE, 0, SETTINGS);
  assert.equal(nav.arrived, false);
  assert.equal(nav.accuracyOk, false);
});

test('the accuracy guard sits at twice the arrival radius', () => {
  assert.equal(computeNav(fixNearWaypoint(0, 10, 59), ROUTE, 0, SETTINGS).arrived, true);
  assert.equal(computeNav(fixNearWaypoint(0, 10, 61), ROUTE, 0, SETTINGS).arrived, false);
});

test('a fix with no accuracy reported is treated as usable', () => {
  // Some devices omit accuracy. Refusing to ever advance would be worse
  // than trusting a fix we have no reason to doubt.
  const nav = computeNav(
    { lat: ROUTE.waypoints[0].lat + metresNorth(10), lon: ROUTE.waypoints[0].lon },
    ROUTE,
    0,
    SETTINGS
  );
  assert.equal(nav.arrived, true);
});

test('a configured arrival radius is respected', () => {
  const wide = { ...SETTINGS, arrivalRadiusM: 200 };
  assert.equal(computeNav(fixNearWaypoint(0, 100, 5), ROUTE, 0, wide).arrived, true);
  assert.equal(computeNav(fixNearWaypoint(0, 100, 5), ROUTE, 0, SETTINGS).arrived, false);
});

// ---------------------------------------------------------------------------
// Auto-advance
// ---------------------------------------------------------------------------

test('arriving at a waypoint advances to the next one', () => {
  assert.equal(advanceIfArrived(fixNearWaypoint(0, 10), ROUTE, 0, SETTINGS), 1);
});

test('being far from the waypoint does not advance', () => {
  assert.equal(advanceIfArrived(fixNearWaypoint(0, 500), ROUTE, 0, SETTINGS), 0);
});

test('a poor fix does not advance even inside the radius', () => {
  assert.equal(advanceIfArrived(fixNearWaypoint(0, 10, 200), ROUTE, 0, SETTINGS), 0);
});

test('advancing moves exactly one waypoint per fix', () => {
  // Even sitting on top of a cluster of waypoints, one fix advances one step.
  let index = 0;
  index = advanceIfArrived(fixNearWaypoint(0, 1), ROUTE, index, SETTINGS);
  assert.equal(index, 1);
});

test('a waypoint already passed does not re-arm when revisited', () => {
  // Sailing back over WP1 while WP2 is the target must not rewind the route.
  const index = advanceIfArrived(fixNearWaypoint(0, 1), ROUTE, 1, SETTINGS);
  assert.equal(index, 1);
});

test('arriving at the final waypoint advances past the end and completes', () => {
  const index = advanceIfArrived(fixNearWaypoint(2, 10), ROUTE, 2, SETTINGS);
  assert.equal(index, 3);
  assert.equal(computeNav(fixNearWaypoint(2, 10), ROUTE, index, SETTINGS).routeComplete, true);
});

test('a completed route does not advance further', () => {
  assert.equal(advanceIfArrived(fixNearWaypoint(2, 1), ROUTE, 3, SETTINGS), 3);
  assert.equal(advanceIfArrived(fixNearWaypoint(2, 1), ROUTE, 99, SETTINGS), 99);
});

test('an empty route never advances', () => {
  assert.equal(advanceIfArrived(fixNearWaypoint(0, 1), { waypoints: [] }, 0, SETTINGS), 0);
});

test('no position fix never advances', () => {
  assert.equal(advanceIfArrived(null, ROUTE, 0, SETTINGS), 0);
});

// ---------------------------------------------------------------------------
// A short simulated passage, end to end
// ---------------------------------------------------------------------------

test('a boat sailing the route advances through every waypoint in order', () => {
  let index = 0;
  const visited = [];

  for (let i = 0; i < ROUTE.waypoints.length; i++) {
    // Approach from 500 m out, then arrive.
    index = advanceIfArrived(fixNearWaypoint(i, 500), ROUTE, index, SETTINGS);
    const nav = computeNav(fixNearWaypoint(i, 500), ROUTE, index, SETTINGS);
    visited.push(nav.targetName);
    index = advanceIfArrived(fixNearWaypoint(i, 5), ROUTE, index, SETTINGS);
  }

  assert.deepEqual(visited, ['WP1', 'WP2', 'WP3']);
  assert.equal(index, 3);
  assert.equal(computeNav(fixNearWaypoint(2, 5), ROUTE, index, SETTINGS).routeComplete, true);
});
