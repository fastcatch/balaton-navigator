/**
 * Loading the shipped routes and applying them to storage.
 *
 * Thin adapter: fetches the file, hands it to the pure `reconcileSeeds`, and
 * writes back whatever that decides. All the rules live in `core/seeds.js`.
 */

import { reconcileSeeds } from './core/seeds.js';
import { STORE_ROUTES, put, loadDismissedSeeds } from './storage.js';

/** Relative path, so a GitHub Pages subpath needs no special handling. */
const SEED_URL = './data/seed-routes.json';

/**
 * Apply the shipped routes to the stored ones.
 *
 * Returns `{ routes, inserted }` — the full route list as it should now be,
 * and just the newly added ones, which the caller uses to decide whether to
 * open on a freshly shipped route.
 *
 * Never throws: a missing or malformed seed file must not stop the app from
 * starting, because the user may well have routes of their own that matter
 * more than anything shipped.
 */
export async function applySeedRoutes(existingRoutes) {
  let seeds;
  try {
    // Same-origin and precached by the service worker, so this also resolves
    // on a first launch with no network.
    const response = await fetch(SEED_URL, { cache: 'no-cache' });
    if (!response.ok) return { routes: existingRoutes, inserted: [] };
    seeds = (await response.json())?.routes;
  } catch {
    return { routes: existingRoutes, inserted: [] };
  }

  const dismissed = await loadDismissedSeeds();
  const { inserts, updates } = reconcileSeeds(seeds, existingRoutes, dismissed);
  if (inserts.length === 0 && updates.length === 0) {
    return { routes: existingRoutes, inserted: [] };
  }

  await Promise.all([...inserts, ...updates].map((route) => put(STORE_ROUTES, route)));

  const updatedById = new Map(updates.map((route) => [route.id, route]));
  return {
    routes: [
      ...existingRoutes.map((route) => updatedById.get(route.id) ?? route),
      ...inserts,
    ],
    inserted: inserts,
  };
}
