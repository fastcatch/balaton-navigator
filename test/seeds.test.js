import test from 'node:test';
import assert from 'node:assert/strict';

import { seedToRoute, reconcileSeeds } from '../js/core/seeds.js';

const SEED = {
  seedId: 'feherszalag-2026',
  version: 1,
  name: 'Fehérszalag 2026',
  waypoints: [
    { name: 'Rajt', lat: 46.9483, lon: 17.8948 },
    { name: 'Cél', lat: 46.9483, lon: 17.8948 },
  ],
};

const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);

// ---------------------------------------------------------------------------
// Building a route from a seed
// ---------------------------------------------------------------------------

test('a seed becomes an ordinary route', () => {
  const route = seedToRoute(SEED, NOW);
  assert.equal(route.name, 'Fehérszalag 2026');
  assert.equal(route.waypoints.length, 2);
  assert.equal(route.waypoints[0].name, 'Rajt');
  assert.equal(route.waypoints[0].lat, 46.9483);
  assert.ok(route.id, 'needs a real id so it behaves like any other route');
});

test('every waypoint gets its own id', () => {
  const route = seedToRoute(SEED, NOW);
  const ids = route.waypoints.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test('a seeded route records where it came from', () => {
  const route = seedToRoute(SEED, NOW);
  assert.equal(route.seedId, 'feherszalag-2026');
  assert.equal(route.seedVersion, 1);
  assert.equal(route.seededAt, NOW);
  // Equal timestamps are what marks it as untouched by the user.
  assert.equal(route.updatedAt, route.seededAt);
});

test('two devices building the same seed get different route ids', () => {
  // seedId is the correlation key across devices, not the route id.
  assert.notEqual(seedToRoute(SEED, NOW).id, seedToRoute(SEED, NOW).id);
});

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

test('a seed not yet on the device is inserted', () => {
  const { inserts, updates } = reconcileSeeds([SEED], [], [], NOW);
  assert.equal(inserts.length, 1);
  assert.equal(updates.length, 0);
  assert.equal(inserts[0].seedId, 'feherszalag-2026');
});

test('nothing is inserted twice on a second run', () => {
  const first = reconcileSeeds([SEED], [], [], NOW).inserts;
  const second = reconcileSeeds([SEED], first, [], NOW);
  assert.equal(second.inserts.length, 0);
  assert.equal(second.updates.length, 0);
});

test('an unrelated user route is left alone', () => {
  const mine = { id: 'r1', name: 'Saját kör', waypoints: [], updatedAt: NOW };
  const { inserts, updates } = reconcileSeeds([SEED], [mine], [], NOW);
  assert.equal(inserts.length, 1);
  assert.equal(updates.length, 0);
});

// ---------------------------------------------------------------------------
// Deletion must stick
// ---------------------------------------------------------------------------

test('a seed the user deleted is not resurrected', () => {
  // Re-adding a deleted route on every launch would be maddening.
  const { inserts } = reconcileSeeds([SEED], [], ['feherszalag-2026'], NOW);
  assert.equal(inserts.length, 0);
});

test('a deleted seed stays gone even when its version is bumped', () => {
  const bumped = { ...SEED, version: 2 };
  const { inserts, updates } = reconcileSeeds([bumped], [], ['feherszalag-2026'], NOW);
  assert.equal(inserts.length, 0);
  assert.equal(updates.length, 0);
});

// ---------------------------------------------------------------------------
// Course changes
// ---------------------------------------------------------------------------

test('a bumped version updates an untouched seeded route', () => {
  // A regatta course can change the day before the start.
  const existing = seedToRoute(SEED, NOW);
  const bumped = {
    ...SEED,
    version: 2,
    name: 'Fehérszalag 2026 (módosított)',
    waypoints: [...SEED.waypoints, { name: 'Tihany', lat: 46.9186, lon: 17.9092 }],
  };

  const { inserts, updates } = reconcileSeeds([bumped], [existing], [], NOW + 1000);
  assert.equal(inserts.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, existing.id, 'must update in place, not duplicate');
  assert.equal(updates[0].seedVersion, 2);
  assert.equal(updates[0].waypoints.length, 3);
  assert.equal(updates[0].name, 'Fehérszalag 2026 (módosított)');
});

test('a bumped version does NOT overwrite a route the user has edited', () => {
  // Their own changes outrank the shipped copy; silently reverting them
  // would be worse than being one version behind.
  const edited = { ...seedToRoute(SEED, NOW), name: 'Saját verzióm', updatedAt: NOW + 5000 };
  const bumped = { ...SEED, version: 2 };

  const { inserts, updates } = reconcileSeeds([bumped], [edited], [], NOW + 9000);
  assert.equal(inserts.length, 0);
  assert.equal(updates.length, 0);
});

test('an older or equal version never overwrites what is on the device', () => {
  const existing = { ...seedToRoute(SEED, NOW), seedVersion: 3 };
  for (const version of [1, 2, 3]) {
    const { updates } = reconcileSeeds([{ ...SEED, version }], [existing], [], NOW);
    assert.equal(updates.length, 0, `version ${version} should not update version 3`);
  }
});

test('updating preserves the original creation time', () => {
  const existing = seedToRoute(SEED, NOW);
  const { updates } = reconcileSeeds([{ ...SEED, version: 2 }], [existing], [], NOW + 1000);
  assert.equal(updates[0].createdAt, existing.createdAt);
  assert.equal(updates[0].seededAt, NOW + 1000);
  assert.equal(updates[0].updatedAt, updates[0].seededAt, 'must stay marked as untouched');
});

// ---------------------------------------------------------------------------
// Robustness — this file is hand-edited, so it will eventually be malformed
// ---------------------------------------------------------------------------

test('several seeds are handled independently', () => {
  const other = { ...SEED, seedId: 'kekszalag-2026', name: 'Kékszalag 2026' };
  const { inserts } = reconcileSeeds([SEED, other], [], ['feherszalag-2026'], NOW);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].seedId, 'kekszalag-2026');
});

test('a seed missing an id or waypoints is skipped rather than crashing', () => {
  const bad = [
    { version: 1, name: 'no id', waypoints: [{ name: 'a', lat: 46, lon: 17 }] },
    { seedId: 'empty', version: 1, name: 'no waypoints', waypoints: [] },
    { seedId: 'missing', version: 1, name: 'undefined waypoints' },
    null,
  ];
  const { inserts } = reconcileSeeds([...bad, SEED], [], [], NOW);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].seedId, 'feherszalag-2026');
});

test('a seed with an unusable coordinate is skipped', () => {
  const bad = { ...SEED, seedId: 'bad-coords', waypoints: [{ name: 'x', lat: 'abc', lon: 17 }] };
  const { inserts } = reconcileSeeds([bad], [], [], NOW);
  assert.equal(inserts.length, 0);
});

test('an empty or missing seed list is not an error', () => {
  assert.deepEqual(reconcileSeeds([], [], [], NOW), { inserts: [], updates: [] });
  assert.deepEqual(reconcileSeeds(null, [], [], NOW), { inserts: [], updates: [] });
});
