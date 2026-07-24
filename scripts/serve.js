/**
 * Minimal static file server for local development.
 *
 * Exists so the app can be opened over http://localhost, which is the one
 * non-HTTPS origin where geolocation and service workers are permitted.
 * Uses only Node built-ins; this project has no dependencies.
 *
 *   npm run serve  ->  http://localhost:8000
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gpx': 'application/gpx+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // normalize collapses ".." so a crafted path cannot escape the project root.
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    let info = await stat(path);
    if (info.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path);
    }

    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      // Always revalidate, so an edit shows up on the next reload rather than
      // being masked by the browser cache during development.
      'Cache-Control': 'no-cache',
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Balaton Navigátor: http://localhost:${PORT}`);
});
