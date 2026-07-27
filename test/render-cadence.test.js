/**
 * Guards the split between `renderLive()` and `render()` in main.js.
 *
 * Rebuilding a list replaces its DOM nodes. `watchPosition` fires about once
 * a second and the compass many times a second, so doing that on every update
 * pulls elements out from under the user's finger. iOS only synthesises a
 * click when touchstart and touchend land on the same element — so every
 * button inside an open list silently stopped working on iPhone while GPS was
 * live, while behaving perfectly on a desktop where no fixes arrive.
 *
 * Nothing at runtime reports this, it cannot be reproduced without a real
 * device, and the obvious "just call render()" edit reintroduces it. Hence a
 * source-level check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'js/main.js'), 'utf8');

/** The `{ ... }` block following `signature`, matched by brace depth. */
function bodyOf(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `could not find "${signature}" in js/main.js`);

  const from = source.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1);
  }
  assert.fail(`unbalanced braces after "${signature}"`);
}

test('renderLive does not rebuild the list views', () => {
  // This is the whole point of the split.
  assert.ok(
    !bodyOf('function renderLive()').includes('views.update'),
    'renderLive() must not call views.update — it runs on every GPS and compass update'
  );
});

test('render does rebuild the list views', () => {
  // Otherwise an open list would never reflect an edit at all.
  assert.ok(
    bodyOf('function render()').includes('views.update'),
    'render() must refresh the open list views'
  );
});

test('the compass handler uses the light render', () => {
  const handler = bodyOf('onHeading: (heading)');
  assert.ok(handler.includes('renderLive()'), 'compass updates must use renderLive()');
  assert.ok(
    !/[^a-zA-Z]render\(\)/.test(handler),
    'compass updates must never trigger a full render — they arrive many times a second'
  );
});

test('the position handler uses the light render on the common path', () => {
  const handler = bodyOf('async function onPosition(');
  assert.ok(handler.includes('renderLive()'), 'position updates must use renderLive()');
  // A full render is allowed only when the target actually advanced, which
  // happens once per waypoint rather than once per second.
  assert.ok(
    !/\n\s*render\(\);/.test(handler),
    'a full render in onPosition must be conditional, not unconditional'
  );
});

test('waypoint markers are only redrawn when they change', () => {
  // Same failure mode as the lists: recreating a marker between touchstart
  // and touchend means tapping a waypoint on the map never registers.
  const body = bodyOf('function renderMapLayers()');
  assert.ok(
    body.includes('drawnWaypoints'),
    'renderMapLayers() must compare against what is already drawn before calling setWaypoints'
  );
  assert.ok(
    /if \(signature !== drawnWaypoints\)/.test(body),
    'setWaypoints must be guarded by a change check'
  );
});

test('renderLive does not rebuild the pager', () => {
  // The page dots are buttons. iOS synthesises a click only when pointerdown
  // and pointerup land on the same element, so recreating them on a GPS fix
  // would silently stop them working on the one device this app is for —
  // while behaving perfectly on a desktop where no fixes arrive. The pager
  // is created once in boot() and never touched again.
  const body = bodyOf('function renderLive()');
  assert.ok(!body.includes('createPager'), 'renderLive must not recreate the pager');
  assert.ok(!body.includes('pagedots'), 'renderLive must not touch the dot container');
});

test('the pager is created exactly once', () => {
  // The import has no parenthesis, so only the call site matches. More than
  // one means a second pager is fighting the first for the same surfaces.
  const calls = source.split('createPager(').length - 1;
  assert.equal(calls, 1, 'createPager should be called once, in boot()');
});

test('the staleness timer uses the light render', () => {
  // A timer is the only thing that decays the readout when fixes stop
  // arriving — without it the panel holds a live-looking SOG on a drifting
  // boat. But it must be renderLive: setInterval(render, ...) would rebuild
  // every open list once a second, which is the same silent iPhone failure
  // this file exists to prevent, except permanent rather than occasional.
  assert.ok(
    /setInterval\(\s*renderLive\s*,/.test(source),
    'a timer must drive renderLive, or stale figures never decay'
  );
  assert.ok(
    !/setInterval\(\s*render\s*,/.test(source),
    'the timer must never call the full render'
  );
});
