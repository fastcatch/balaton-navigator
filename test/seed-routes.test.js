/**
 * Validates the shipped route data itself.
 *
 * `data/seed-routes.json` is hand-edited and goes out to every device. A
 * transposed digit here is not a crash — it is a course that quietly points
 * somewhere wrong, which is the worst failure this app has.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconcileSeeds } from '../js/core/seeds.js';
import { haversine } from '../js/core/geo.js';
import { BALATON_BOUNDS } from '../js/core/model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'data/seed-routes.json'), 'utf8');

test('the seed file is valid JSON with a routes array', () => {
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.routes), 'expected a top-level "routes" array');
});

const { routes } = JSON.parse(raw);

test('every route has a seedId, version, name and waypoints', () => {
  for (const route of routes) {
    assert.ok(route.seedId, 'a route is missing seedId');
    assert.match(route.seedId, /^[a-z0-9-]+$/, `seedId should be a slug: ${route.seedId}`);
    assert.ok(Number.isInteger(route.version) && route.version >= 1, `bad version on ${route.seedId}`);
    assert.ok(route.name?.trim(), `missing name on ${route.seedId}`);
    assert.ok(route.waypoints?.length >= 2, `${route.seedId} needs at least two waypoints`);
  }
});

test('seedIds are unique', () => {
  const ids = routes.map((r) => r.seedId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate seedId');
});

test('every waypoint has a name and numeric coordinates', () => {
  for (const route of routes) {
    for (const [i, wp] of route.waypoints.entries()) {
      const where = `${route.seedId}[${i}]`;
      assert.ok(wp.name?.trim(), `missing name at ${where}`);
      assert.equal(typeof wp.lat, 'number', `lat must be a number at ${where}`);
      assert.equal(typeof wp.lon, 'number', `lon must be a number at ${where}`);
    }
  }
});

test('every waypoint lies within the Balaton bounding box', () => {
  // These are Balaton courses. A coordinate outside the lake's box is a typo,
  // not a design decision.
  for (const route of routes) {
    for (const wp of route.waypoints) {
      const where = `${route.seedId} / ${wp.name}`;
      assert.ok(
        wp.lat >= BALATON_BOUNDS.south && wp.lat <= BALATON_BOUNDS.north,
        `latitude outside Balaton at ${where}: ${wp.lat}`
      );
      assert.ok(
        wp.lon >= BALATON_BOUNDS.west && wp.lon <= BALATON_BOUNDS.east,
        `longitude outside Balaton at ${where}: ${wp.lon}`
      );
    }
  }
});

test('no two consecutive waypoints are the same point', () => {
  // Start and finish sharing a position is normal for a regatta; two
  // identical points in a row is not, and would make a leg of zero length
  // with an undefined bearing.
  for (const route of routes) {
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = { lat: route.waypoints[i - 1].lat, lon: route.waypoints[i - 1].lon };
      const b = { lat: route.waypoints[i].lat, lon: route.waypoints[i].lon };
      assert.ok(
        haversine(a, b) > 1,
        `${route.seedId}: waypoints ${i} and ${i + 1} are the same point`
      );
    }
  }
});

test('no leg is implausibly long for the lake', () => {
  // Balaton is ~78 km end to end; a longer leg means a coordinate is wrong.
  for (const route of routes) {
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = { lat: route.waypoints[i - 1].lat, lon: route.waypoints[i - 1].lon };
      const b = { lat: route.waypoints[i].lat, lon: route.waypoints[i].lon };
      const km = haversine(a, b) / 1000;
      assert.ok(km < 80, `${route.seedId}: leg ${i} is ${km.toFixed(1)} km`);
    }
  }
});

test('every shipped route survives reconciliation', () => {
  // Guards against a route that validates by eye but is silently dropped by
  // the seeding rules, leaving the fleet with nothing.
  const { inserts } = reconcileSeeds(routes, [], []);
  assert.equal(inserts.length, routes.length, 'some routes were rejected by reconcileSeeds');
});

test('the Fehérszalag 2026 course is present and correct', () => {
  const race = routes.find((r) => r.seedId === 'feherszalag-2026');
  assert.ok(race, 'feherszalag-2026 is missing');

  assert.deepEqual(
    race.waypoints.map((w) => w.name),
    ['Rajt', 'Kenese', 'Siófok', 'Tihany', 'Cél']
  );

  // Start and finish are the same line at Balatonfüred.
  assert.equal(race.waypoints[0].lat, race.waypoints.at(-1).lat);
  assert.equal(race.waypoints[0].lon, race.waypoints.at(-1).lon);

  // Total course length, as cross-checked against the app's own display.
  let total = 0;
  for (let i = 1; i < race.waypoints.length; i++) {
    total += haversine(race.waypoints[i - 1], race.waypoints[i]);
  }
  assert.ok(
    Math.abs(total / 1000 - 43.9) < 0.5,
    `expected ~43.9 km total, got ${(total / 1000).toFixed(2)} km`
  );
});
