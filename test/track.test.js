import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitOnGaps,
  epsilonForZoom,
  renderableSegments,
  GAP_THRESHOLD_MS,
} from '../js/core/track.js';

const SECOND = 1000;
const base = Date.UTC(2026, 6, 24, 8, 0, 0);

/** A run of `n` points one second apart, starting `offsetMs` in. */
const run = (n, offsetMs = 0, lat0 = 46.9) =>
  Array.from({ length: n }, (_, i) => ({
    lat: lat0 + i * 0.0005,
    lon: 17.9,
    t: base + offsetMs + i * SECOND,
  }));

// ---------------------------------------------------------------------------
// Gap splitting
// ---------------------------------------------------------------------------

test('an empty track has no segments', () => {
  assert.deepEqual(splitOnGaps([]), []);
});

test('a continuous track is one segment', () => {
  assert.equal(splitOnGaps(run(10)).length, 1);
  assert.equal(splitOnGaps(run(10))[0].length, 10);
});

test('a pause longer than the threshold splits the track', () => {
  // The screen locked for ten minutes. Drawing a straight line across that
  // would claim the boat sailed a leg it did not.
  const points = [...run(5), ...run(5, 10 * 60 * SECOND, 47.0)];
  const segments = splitOnGaps(points);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 5);
  assert.equal(segments[1].length, 5);
});

test('a pause shorter than the threshold does not split', () => {
  const points = [...run(5), ...run(5, GAP_THRESHOLD_MS - SECOND, 46.95)];
  assert.equal(splitOnGaps(points).length, 1);
});

test('several gaps produce several segments', () => {
  const points = [
    ...run(3),
    ...run(3, 5 * 60 * SECOND, 47.0),
    ...run(3, 20 * 60 * SECOND, 47.1),
  ];
  assert.equal(splitOnGaps(points).length, 3);
});

test('splitting preserves every point', () => {
  const points = [...run(4), ...run(6, 10 * 60 * SECOND, 47.0)];
  const total = splitOnGaps(points).reduce((n, seg) => n + seg.length, 0);
  assert.equal(total, points.length);
});

test('the gap threshold is configurable', () => {
  const points = [...run(3), ...run(3, 5 * SECOND, 46.95)];
  assert.equal(splitOnGaps(points, 2 * SECOND).length, 2);
  assert.equal(splitOnGaps(points, 60 * SECOND).length, 1);
});

// ---------------------------------------------------------------------------
// Zoom-dependent simplification tolerance
// ---------------------------------------------------------------------------

test('zooming in tightens the simplification tolerance', () => {
  for (let z = 5; z < 18; z++) {
    assert.ok(
      epsilonForZoom(z + 1) < epsilonForZoom(z),
      `epsilon should shrink from zoom ${z} to ${z + 1}`
    );
  }
});

test('the tolerance at typical sailing zoom is a few metres', () => {
  // Around zoom 14 the whole lake width is a screen or two. Detail finer
  // than a few metres cannot be seen, so discarding it is free.
  const e = epsilonForZoom(14);
  assert.ok(e > 1 && e < 30, `expected a few metres at zoom 14, got ${e}`);
});

test('the tolerance is always positive', () => {
  for (let z = 0; z <= 22; z++) assert.ok(epsilonForZoom(z) > 0);
});

// ---------------------------------------------------------------------------
// Renderable segments
// ---------------------------------------------------------------------------

test('rendering an empty track produces nothing', () => {
  assert.deepEqual(renderableSegments([], 14), []);
});

test('rendering thins a dense straight track heavily', () => {
  const straight = Array.from({ length: 2000 }, (_, i) => ({
    lat: 46.9 + i * 0.00001,
    lon: 17.9,
    t: base + i * SECOND,
  }));
  const out = renderableSegments(straight, 14);
  assert.equal(out.length, 1);
  assert.ok(out[0].length < 20, `expected heavy thinning, got ${out[0].length} points`);
});

test('rendering keeps endpoints of every segment', () => {
  const points = [...run(20), ...run(20, 10 * 60 * SECOND, 47.0)];
  const out = renderableSegments(points, 14);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0][0], points[0]);
  assert.deepEqual(out[1].at(-1), points.at(-1));
});

test('rendering never exceeds the point cap', () => {
  // A zigzag defeats simplification, so only the cap can hold the count down.
  const zigzag = Array.from({ length: 30000 }, (_, i) => ({
    lat: 46.9 + i * 0.0001,
    lon: 17.9 + (i % 2) * 0.01,
    t: base + i * SECOND,
  }));
  const out = renderableSegments(zigzag, 18, 2000);
  const total = out.reduce((n, seg) => n + seg.length, 0);
  assert.ok(total <= 2000, `expected at most 2000 rendered points, got ${total}`);
});

test('rendering a long pathological track stays fast', () => {
  // A regular zigzag gives Douglas-Peucker many equally-deviating points,
  // which drives it to its O(n^2) worst case. Before the input bound this
  // took minutes; it must stay interactive.
  const zigzag = Array.from({ length: 30000 }, (_, i) => ({
    lat: 46.9 + i * 0.0001,
    lon: 17.9 + (i % 2) * 0.01,
    t: base + i * SECOND,
  }));

  const started = performance.now();
  renderableSegments(zigzag, 18, 2000);
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 2000, `rendering took ${elapsed.toFixed(0)} ms`);
});

test('rendering keeps a real bend in a short track at high zoom', () => {
  const bend = [
    { lat: 46.9, lon: 17.9, t: base },
    { lat: 46.9005, lon: 17.9008, t: base + SECOND },
    { lat: 46.901, lon: 17.9, t: base + 2 * SECOND },
  ];
  assert.equal(renderableSegments(bend, 18)[0].length, 3);
});

test('rendering collapses a straight run to its endpoints', () => {
  // Three points on one line carry no more information than two.
  assert.equal(renderableSegments(run(3), 18)[0].length, 2);
});
