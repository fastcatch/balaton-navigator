/**
 * IndexedDB persistence.
 *
 * The spec is inconsistent here — section 3 permits localStorage or
 * IndexedDB, section 5 says everything is in IndexedDB. This resolves to
 * IndexedDB throughout: a multi-hour track is far past what localStorage
 * should hold, and one store is simpler than two.
 */

import { defaultSettings } from './core/model.js';

const DB_NAME = 'balaton-navigator';
const DB_VERSION = 1;

export const STORE_ROUTES = 'routes';
export const STORE_TRACKS = 'tracks';
const STORE_META = 'meta';

const APP_STATE_KEY = 'app';
const SETTINGS_KEY = 'settings';
const DISMISSED_SEEDS_KEY = 'dismissedSeeds';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [STORE_ROUTES, STORE_TRACKS, STORE_META]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function run(storeName, mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(request?.result);
      })
  );
}

export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const remove = (store, id) => run(store, 'readwrite', (s) => s.delete(id));

// --- Singletons -----------------------------------------------------------

/**
 * Which route is active and which waypoint is the target.
 *
 * Persisted rather than held in memory because iOS discards backgrounded
 * PWA tabs. Without this, glancing at a message mid-passage would silently
 * reset the target to the first waypoint — a wrong-direction bug caused by
 * nothing but a lifecycle event.
 */
export async function loadAppState() {
  const stored = await get(STORE_META, APP_STATE_KEY);
  return {
    activeRouteId: stored?.activeRouteId ?? null,
    targetIndex: stored?.targetIndex ?? 0,
    recordingTrackId: stored?.recordingTrackId ?? null,
  };
}

export function saveAppState(state) {
  return put(STORE_META, { id: APP_STATE_KEY, ...state });
}

export async function loadSettings() {
  const stored = await get(STORE_META, SETTINGS_KEY);
  // Merge over defaults so a settings object written by an older version
  // gains new keys instead of yielding undefined.
  return { ...defaultSettings(), ...(stored ?? {}) };
}

export function saveSettings(settings) {
  const { id, ...rest } = settings;
  return put(STORE_META, { id: SETTINGS_KEY, ...rest });
}

/**
 * seedIds of shipped routes the user has deleted.
 *
 * Without this tombstone list, every launch would helpfully restore the route
 * they just threw away.
 */
export async function loadDismissedSeeds() {
  const stored = await get(STORE_META, DISMISSED_SEEDS_KEY);
  return stored?.seedIds ?? [];
}

export async function dismissSeed(seedId) {
  const seedIds = await loadDismissedSeeds();
  if (seedIds.includes(seedId)) return seedIds;

  const next = [...seedIds, seedId];
  await put(STORE_META, { id: DISMISSED_SEEDS_KEY, seedIds: next });
  return next;
}

// --- Durability -----------------------------------------------------------

/**
 * Ask the browser not to evict this origin's data under storage pressure.
 *
 * Best-effort: Safari may decline. Installing to the home screen is the more
 * reliable protection, which is why the README leads with it.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
