/**
 * Service worker: offline app shell plus progressive tile caching (spec 6.5).
 *
 * ---------------------------------------------------------------------------
 * OSM TILE POLICY — READ BEFORE CHANGING THE TILE HANDLING BELOW
 *
 * Only tiles the user has actually looked at are ever cached. Tiles enter the
 * cache as a side effect of being requested by the map for display, and by no
 * other route. There is deliberately no prefetch, no "download this region",
 * no zoom-level sweep, and no background warming.
 *
 * That distinction is what keeps this inside the OSM tile usage policy
 * (operations.osmfoundation.org/policies/tiles), which permits caching what
 * was browsed and forbids bulk downloading. Spec section 11 rules out an
 * offline-region button for the same reason.
 * ---------------------------------------------------------------------------
 */

/**
 * The two caches are versioned independently, and must stay that way.
 *
 * Bump SHELL_VERSION on any change to the files in SHELL below. `activate`
 * deletes every `balaton-` cache that is not one of the two current names, so
 * a shared constant would throw away the whole tile cache every time a line
 * of CSS changed — and those tiles can only be refilled by browsing the lake
 * again with a data connection, which is exactly what nobody has on the
 * water.
 *
 * Bumping the shell is not optional housekeeping: `cache.addAll` fetches
 * through the HTTP cache, and GitHub Pages serves the shell with a ten-minute
 * max-age. Reusing the cache name after a deploy can therefore re-store the
 * stale copy it was meant to replace, which presents as the new build simply
 * not being there.
 *
 * TILE_VERSION exists only so the tile cache can be discarded deliberately —
 * a change to the tile key format or host list. Routine deploys leave it be.
 */
const SHELL_VERSION = 'v7';
const TILE_VERSION = 'v6';
const SHELL_CACHE = `balaton-shell-${SHELL_VERSION}`;
const TILE_CACHE = `balaton-tiles-${TILE_VERSION}`;

/** Roughly 40 MB of tiles. Enough for the whole lake at working zooms. */
const TILE_CACHE_LIMIT = 2000;

/** Trim in batches: counting the cache on every tile would cost more than it saves. */
const TILE_TRIM_INTERVAL = 50;

const TILE_HOSTS = new Set(['tile.openstreetmap.org', 'tiles.openseamap.org']);

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './js/main.js',
  './js/map.js',
  './js/storage.js',
  './js/position.js',
  './js/compass.js',
  './js/tracker.js',
  './js/core/geo.js',
  './js/core/cog.js',
  './js/core/navigation.js',
  './js/core/track.js',
  './js/core/gpx.js',
  './js/core/model.js',
  './js/core/seeds.js',
  './js/core/instruments.js',
  './js/seeds.js',
  // Precached so the shipped routes are available on a first launch with no
  // network — which is exactly the morning-of-the-race case.
  './data/seed-routes.json',
  './js/ui/dom.js',
  './js/ui/view.js',
  './js/ui/navpanel.js',
  './js/ui/datapanel.js',
  './js/ui/routes.js',
  './js/ui/tracks.js',
  './js/ui/settings.js',
  './js/ui/pager.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/**
 * Placeholder for a tile that was never cached and cannot be fetched.
 *
 * Hatched rather than blank so missing map reads as "not downloaded" instead
 * of as open water — a blank tile over a shoreline would be actively
 * misleading to someone navigating.
 */
const MISSING_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
<defs><pattern id="h" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<line x1="0" y1="0" x2="0" y2="12" stroke="#20455f" stroke-width="2"/></pattern></defs>
<rect width="256" height="256" fill="#0f2b41"/><rect width="256" height="256" fill="url(#h)"/>
</svg>`;

const missingTileResponse = () =>
  new Response(MISSING_TILE_SVG, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is atomic: one failure aborts the install rather than leaving a
      // half-cached shell that boots into a broken app offline.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('balaton-') && name !== SHELL_CACHE && name !== TILE_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Tile cache
// ---------------------------------------------------------------------------

let tilesSinceTrim = 0;

/**
 * Drop the oldest entries once the cache exceeds its limit.
 *
 * `cache.keys()` returns insertion order, so this is FIFO rather than true
 * LRU. Good enough here: tiles are added as the boat moves, so the oldest
 * entries are reliably the ones furthest behind it.
 */
async function trimTileCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - TILE_CACHE_LIMIT;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/**
 * Cache-first for tiles: a tile already downloaded is served from disk even
 * when online, which is what makes the map keep working when the mobile
 * signal drops out on open water.
 */
async function handleTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque responses (status 0) are cross-origin without CORS; caching them
    // would consume quota without ever being readable as a valid tile.
    if (response.ok) {
      await cache.put(request, response.clone());
      if (++tilesSinceTrim >= TILE_TRIM_INTERVAL) {
        tilesSinceTrim = 0;
        trimTileCache(cache);
      }
    }
    return response;
  } catch {
    return missingTileResponse();
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith(handleTile(request));
    return;
  }

  // Same-origin only from here: nothing else should be intercepted.
  if (url.origin !== self.location.origin) return;

  // A navigation offline must still open the app, whatever path was asked for.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Cache-first for the shell. The app must boot with no network at all, and
  // a version bump above is what ships an update.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
