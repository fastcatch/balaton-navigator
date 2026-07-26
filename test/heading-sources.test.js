/**
 * Guards the split between the two directions the app knows about.
 *
 * `state.viewHeading` is the compass: which way the phone is pointing, and
 * therefore which way the person holding it is looking. `state.cog` is GPS:
 * which way the boat is travelling.
 *
 * Crossing them is the bug this file exists to prevent. A turn instruction
 * computed from a phone lying at an angle in the cockpit looks exactly like a
 * correct one, and would be trusted at a mark rounding. Nothing at runtime
 * would report it, so it is checked at the source level — the same approach
 * `test/render-cadence.test.js` takes for its own invisible failure.
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

test('the compass feeds the map and nothing else', () => {
  const handler = bodyOf('onHeading: (heading)');
  assert.ok(
    handler.includes('state.viewHeading'),
    'the compass handler must write state.viewHeading'
  );
  assert.ok(
    !handler.includes('state.cog'),
    'the compass must never feed the turn indicator — the phone is not aligned with the boat'
  );
});

test('GPS course is not substituted for the compass on the map', () => {
  const handler = bodyOf('async function onPosition(');
  assert.ok(
    !/state\.viewHeading\s*=/.test(handler),
    'onPosition must not set viewHeading: the sight line is compass-only, never inferred'
  );
});

test('position fixes are buffered for the COG filter', () => {
  const handler = bodyOf('async function onPosition(');
  assert.ok(
    handler.includes('state.cogSamples'),
    'onPosition must append to the COG sample buffer'
  );
});

test('the turn indicator is computed from the buffer, not from the compass', () => {
  const body = bodyOf('function renderLive()');
  assert.ok(body.includes('computeCog('), 'renderLive must compute the course over ground');
  assert.ok(
    /computeCog\(\s*state\.cogSamples/.test(body),
    'computeCog must be fed the GPS sample buffer'
  );
});
