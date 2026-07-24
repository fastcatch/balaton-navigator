import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createId,
  createWaypoint,
  createRoute,
  createTrack,
  defaultWaypointName,
  defaultRouteName,
  defaultTrackName,
  defaultSettings,
  parseCoordinate,
  validateCoordinates,
  BALATON_BOUNDS,
} from '../js/core/model.js';

// ---------------------------------------------------------------------------
// Identity and factories
// ---------------------------------------------------------------------------

test('generated ids are unique', () => {
  const ids = new Set(Array.from({ length: 1000 }, createId));
  assert.equal(ids.size, 1000);
});

test('a new waypoint carries a name and coordinates and no order field', () => {
  const wp = createWaypoint({ name: 'Tihanyi kikötő', lat: 46.895, lon: 17.8878 });
  assert.equal(wp.name, 'Tihanyi kikötő');
  assert.equal(wp.lat, 46.895);
  assert.equal(wp.lon, 17.8878);
  assert.ok(wp.id);
  // Array position is the single source of truth for ordering.
  assert.equal('order' in wp, false);
});

test('a new route starts empty with matching timestamps', () => {
  const route = createRoute({ name: 'Kör' });
  assert.equal(route.name, 'Kör');
  assert.deepEqual(route.waypoints, []);
  assert.equal(route.createdAt, route.updatedAt);
  assert.ok(route.id);
});

test('a new track is open-ended and records its originating route', () => {
  const track = createTrack({ name: 'Túra', routeId: 'r1' });
  assert.equal(track.endedAt, null);
  assert.equal(track.routeId, 'r1');
  assert.deepEqual(track.points, []);
  assert.equal(track.pointCount, 0);
  assert.ok(track.startedAt > 0);
});

test('a track without a route records null rather than undefined', () => {
  assert.equal(createTrack({ name: 'Szabad' }).routeId, null);
});

// ---------------------------------------------------------------------------
// Default names
// ---------------------------------------------------------------------------

test('waypoints are named WP1 upward from a zero-based index', () => {
  assert.equal(defaultWaypointName(0), 'WP1');
  assert.equal(defaultWaypointName(9), 'WP10');
});

test('default route and track names are derived from the date', () => {
  const at = new Date(2026, 6, 24, 14, 5, 0);
  assert.equal(defaultTrackName(at), '2026-07-24 14:05');
  assert.match(defaultRouteName(at), /2026-07-24/);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test('default settings match the spec', () => {
  const s = defaultSettings();
  assert.equal(s.units, 'metric');
  assert.equal(s.arrivalRadiusM, 30); // spec 6.4
  assert.equal(s.minAccuracyM, 50); // spec 6.3
  assert.equal(s.keepAwake, true);
});

// ---------------------------------------------------------------------------
// Coordinate parsing — Hungarian keyboards produce decimal commas
// ---------------------------------------------------------------------------

test('a plain decimal string parses', () => {
  assert.equal(parseCoordinate('46.9483'), 46.9483);
  assert.equal(parseCoordinate('-3.07'), -3.07);
});

test('a decimal comma parses, because Hungarian keyboards produce one', () => {
  assert.equal(parseCoordinate('46,9483'), 46.9483);
});

test('surrounding whitespace is ignored', () => {
  assert.equal(parseCoordinate('  46.9483  '), 46.9483);
});

test('a degree suffix is tolerated', () => {
  assert.equal(parseCoordinate('46.9483°'), 46.9483);
});

test('non-numeric input parses to null rather than NaN', () => {
  assert.equal(parseCoordinate('abc'), null);
  assert.equal(parseCoordinate(''), null);
  assert.equal(parseCoordinate('   '), null);
  assert.equal(parseCoordinate(null), null);
  assert.equal(parseCoordinate('46.9.48'), null);
});

// ---------------------------------------------------------------------------
// Coordinate validation
// ---------------------------------------------------------------------------

test('a Balaton coordinate validates cleanly', () => {
  const r = validateCoordinates('46.9483', '17.8869');
  assert.equal(r.ok, true);
  assert.equal(r.lat, 46.9483);
  assert.equal(r.lon, 17.8869);
  assert.equal(r.warning, null);
});

test('unparseable input is rejected with a message naming the field', () => {
  const r = validateCoordinates('abc', '17.8869');
  assert.equal(r.ok, false);
  assert.match(r.error, /szélesség/i);
});

test('out-of-globe coordinates are rejected', () => {
  assert.equal(validateCoordinates('91', '17.9').ok, false);
  assert.equal(validateCoordinates('-91', '17.9').ok, false);
  assert.equal(validateCoordinates('46.9', '181').ok, false);
  assert.equal(validateCoordinates('46.9', '-181').ok, false);
});

test('the poles and the antimeridian are accepted as valid coordinates', () => {
  assert.equal(validateCoordinates('90', '180').ok, true);
  assert.equal(validateCoordinates('-90', '-180').ok, true);
});

test('a valid coordinate far from Balaton is accepted but warned about', () => {
  // Rejecting would be wrong: the user may legitimately plan elsewhere.
  // Silently accepting would hide a typo. So: accept, and say something.
  const r = validateCoordinates('64.9483', '17.8869');
  assert.equal(r.ok, true);
  assert.ok(r.warning);
  assert.match(r.warning, /Balaton/i);
});

test('the Balaton bounds enclose the lake and not much else', () => {
  const inside = (lat, lon) =>
    lat >= BALATON_BOUNDS.south &&
    lat <= BALATON_BOUNDS.north &&
    lon >= BALATON_BOUNDS.west &&
    lon <= BALATON_BOUNDS.east;

  assert.ok(inside(46.9483, 17.8869), 'Balatonfüred should be inside');
  assert.ok(inside(46.755, 17.245), 'Keszthely should be inside');
  assert.ok(inside(46.9067, 18.0483), 'Siófok should be inside');
  assert.ok(!inside(47.4979, 19.0402), 'Budapest should be outside');
  assert.ok(!inside(46.2530, 20.1414), 'Szeged should be outside');
});
