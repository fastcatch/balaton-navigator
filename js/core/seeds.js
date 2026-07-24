/**
 * Reconciling the routes shipped in `data/seed-routes.json` against what is
 * already on the device.
 *
 * Pure module: takes the parsed seed list and the stored routes, returns what
 * to insert and what to update. Does no I/O, so every rule below is tested.
 *
 * Three rules, in order of precedence:
 *
 *   1. A seed the user deleted stays deleted. Re-adding it on every launch
 *      would be maddening.
 *   2. A route the user has edited is never overwritten. Their changes
 *      outrank the shipped copy; silently reverting them is worse than
 *      running one version behind.
 *   3. Otherwise a bumped version wins, so a course corrected the day before
 *      a race actually reaches the fleet.
 */

import { createId } from './model.js';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a seed entry is complete enough to build a route from. */
function isUsableSeed(seed) {
  if (!seed || typeof seed.seedId !== 'string' || seed.seedId === '') return false;
  if (!Array.isArray(seed.waypoints) || seed.waypoints.length === 0) return false;

  return seed.waypoints.every(
    (wp) =>
      wp &&
      isFiniteNumber(wp.lat) &&
      isFiniteNumber(wp.lon) &&
      wp.lat >= -90 && wp.lat <= 90 &&
      wp.lon >= -180 && wp.lon <= 180
  );
}

/**
 * Build a route from a seed entry.
 *
 * The route gets a fresh id and behaves exactly like a hand-made one; only
 * the `seedId` marks its origin. Ids are not taken from the file because two
 * devices must be able to hold their own independent copies.
 */
export function seedToRoute(seed, now = Date.now()) {
  return {
    id: createId(),
    name: seed.name,
    waypoints: seed.waypoints.map((wp, i) => ({
      id: createId(),
      name: wp.name || `WP${i + 1}`,
      lat: wp.lat,
      lon: wp.lon,
    })),
    createdAt: now,
    // updatedAt equal to seededAt is what marks the route as untouched.
    // Any user edit bumps updatedAt and freezes the route against updates.
    updatedAt: now,
    seedId: seed.seedId,
    seedVersion: seed.version ?? 1,
    seededAt: now,
  };
}

/** A seeded route counts as edited once its updatedAt has moved past seeding. */
const isUserEdited = (route) => route.updatedAt > route.seededAt;

/**
 * Work out what the seed file implies for the routes already stored.
 *
 * @param seeds       parsed `routes` array from the seed file
 * @param existing    all routes currently in storage
 * @param dismissed   seedIds the user has deleted
 * @returns `{ inserts, updates }` — routes to add, and routes to overwrite
 */
export function reconcileSeeds(seeds, existing = [], dismissed = [], now = Date.now()) {
  const inserts = [];
  const updates = [];

  if (!Array.isArray(seeds)) return { inserts, updates };

  const dismissedSet = new Set(dismissed);
  const bySeedId = new Map(
    existing.filter((route) => route?.seedId).map((route) => [route.seedId, route])
  );

  for (const seed of seeds) {
    // The file is hand-edited, so a malformed entry is expected eventually.
    // Skip it rather than taking down every other seed with it.
    if (!isUsableSeed(seed)) continue;
    if (dismissedSet.has(seed.seedId)) continue;

    const current = bySeedId.get(seed.seedId);

    if (!current) {
      inserts.push(seedToRoute(seed, now));
      continue;
    }

    const version = seed.version ?? 1;
    if (version <= (current.seedVersion ?? 0)) continue;
    if (isUserEdited(current)) continue;

    // Refresh in place: same route id, so an active route stays active and
    // does not turn into a duplicate in the list.
    const refreshed = seedToRoute(seed, now);
    updates.push({
      ...refreshed,
      id: current.id,
      createdAt: current.createdAt,
    });
  }

  return { inserts, updates };
}
