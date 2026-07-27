import test from 'node:test';
import assert from 'node:assert/strict';

import { computeInstruments } from '../js/core/instruments.js';

// Three waypoints in a due-north line, roughly 1.1 km apart.
const ROUTE = {
  waypoints: [
    { id: 'a', name: 'WP1', lat: 46.90, lon: 17.90 },
    { id: 'b', name: 'WP2', lat: 46.91, lon: 17.90 },
    { id: 'c', name: 'WP3', lat: 46.92, lon: 17.90 },
  ],
};

/** Nav state as `computeNav` would report it, heading due north to WP2. */
const NAV = { hasTarget: true, targetIndex: 1, targetName: 'WP2', bearing: 0, distance: 1000 };

const STEADY_NORTH = { cog: 0, spreadDeg: 1, status: 'ok' };
const NO_COG = { cog: null, spreadDeg: null, status: 'slow' };

const at = (lat, lon) => ({ lat, lon, accuracy: 5, speed: null, heading: null, t: 0 });

test('velocity made good equals speed when sailing straight at the mark', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: STEADY_NORTH, sogMps: 3,
  });
  assert.ok(Math.abs(r.vmcMps - 3) < 0.001, `expected 3, got ${r.vmcMps}`);
});

test('velocity made good goes negative on a losing tack', () => {
  // Sailing due south while the mark lies due north.
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: { cog: 180, spreadDeg: 1, status: 'ok' }, sogMps: 3,
  });
  assert.ok(r.vmcMps < 0, `expected a negative VMC, got ${r.vmcMps}`);
});

test('velocity made good is unavailable without a course', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: NO_COG, sogMps: 3,
  });
  assert.equal(r.vmcMps, null);
  assert.equal(r.ttgSeconds, null);
});

test('time to go divides the distance by the closing speed', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: STEADY_NORTH, sogMps: 2,
  });
  // 1000 m at 2 m/s.
  assert.ok(Math.abs(r.ttgSeconds - 500) < 1, `expected ~500 s, got ${r.ttgSeconds}`);
});

test('sailing away from the mark has no arrival time', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: { cog: 180, spreadDeg: 1, status: 'ok' }, sogMps: 3,
  });
  // Zero would divide to infinity and a negative would give a time past.
  assert.equal(r.ttgSeconds, null);
});

test('cross-track error is measured from the previous waypoint', () => {
  // East of the WP1 to WP2 line, so starboard of a northward track.
  const r = computeInstruments({
    position: at(46.905, 17.91), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: STEADY_NORTH, sogMps: 3,
  });
  assert.ok(r.xteM > 500, `expected a few hundred metres to starboard, got ${r.xteM}`);
});

test('the first leg has no cross-track error', () => {
  // Nothing lies behind WP1, so there is no intended track to be off.
  const r = computeInstruments({
    position: at(46.895, 17.91), route: ROUTE, targetIndex: 0,
    nav: { ...NAV, targetIndex: 0, targetName: 'WP1' }, cog: STEADY_NORTH, sogMps: 3,
  });
  assert.equal(r.xteM, null);
});

test('the distance remaining adds the legs still ahead', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 1,
    nav: NAV, cog: STEADY_NORTH, sogMps: 3,
  });
  // 1000 m to WP2, plus the WP2 to WP3 leg of about 1112 m.
  assert.ok(Math.abs(r.remainingM - 2112) < 20, `expected ~2112 m, got ${r.remainingM}`);
});

test('the last leg leaves nothing ahead to add', () => {
  const r = computeInstruments({
    position: at(46.915, 17.90), route: ROUTE, targetIndex: 2,
    nav: { ...NAV, targetIndex: 2, targetName: 'WP3' }, cog: STEADY_NORTH, sogMps: 3,
  });
  assert.ok(Math.abs(r.remainingM - 1000) < 1, `expected just the leg itself, got ${r.remainingM}`);
});

test('everything but speed is unavailable without a target', () => {
  const r = computeInstruments({
    position: at(46.905, 17.90), route: ROUTE, targetIndex: 0,
    nav: { hasTarget: false, bearing: null, distance: null }, cog: STEADY_NORTH, sogMps: 3,
  });
  assert.equal(r.sogMps, 3, 'speed over ground does not depend on a target');
  assert.equal(r.vmcMps, null);
  assert.equal(r.ttgSeconds, null);
  assert.equal(r.xteM, null);
  assert.equal(r.remainingM, null);
});
