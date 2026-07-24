/**
 * The service worker precaches an explicit file list, and `cache.addAll` is
 * atomic — one wrong path and the install fails, leaving the app with no
 * offline support at all. Nothing at runtime would report that.
 *
 * These tests keep the list honest against what is actually on disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const indexSource = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** The SHELL array from sw.js, as a list of repo-relative paths. */
const shellPaths = (() => {
  const match = swSource.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(match, 'could not find the SHELL array in sw.js');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, ''));
})();

/** Every .js file under js/, as repo-relative paths. */
function jsFiles(dir = 'js') {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...jsFiles(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('every precached path exists on disk', () => {
  for (const path of shellPaths) {
    if (path === '') continue; // './' is the directory index
    assert.ok(existsSync(join(ROOT, path)), `sw.js precaches a missing file: ${path}`);
  }
});

test('every application module is precached', () => {
  // A module missing from the list loads fine online and 404s offline —
  // exactly the failure this app cannot afford on open water.
  for (const file of jsFiles()) {
    assert.ok(shellPaths.includes(file), `sw.js does not precache ${file}`);
  }
});

test('the app shell, manifest and icons are precached', () => {
  for (const required of ['index.html', 'manifest.webmanifest', 'css/app.css']) {
    assert.ok(shellPaths.includes(required), `sw.js does not precache ${required}`);
  }
  assert.ok(
    shellPaths.some((p) => p.startsWith('icons/')),
    'sw.js precaches no icons'
  );
});

test('vendored Leaflet is precached, so the app boots offline', () => {
  assert.ok(shellPaths.includes('vendor/leaflet/leaflet.js'));
  assert.ok(shellPaths.includes('vendor/leaflet/leaflet.css'));
});

test('the precache list has no duplicates', () => {
  assert.equal(new Set(shellPaths).size, shellPaths.length);
});

test('index.html references only files that exist', () => {
  const refs = [...indexSource.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'no references found in index.html');
  for (const ref of refs) {
    assert.ok(existsSync(join(ROOT, ref)), `index.html references a missing file: ${ref}`);
  }
});

test('the manifest names icons that exist', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), `manifest names a missing icon: ${icon.src}`);
  }
});

test('the manifest uses relative scope, so a GitHub Pages subpath works', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
});

test('the service worker is registered by relative path', () => {
  const main = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
  // An absolute '/sw.js' would 404 under a GitHub Pages project subpath.
  assert.ok(main.includes("register('./sw.js')"), 'sw registration should use a relative path');
});
