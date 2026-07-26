import test from 'node:test';
import assert from 'node:assert/strict';

import { computeCog, MIN_SPEED_MPS, STALE_MS } from '../js/core/cog.js';

const NOW = 1_700_000_000_000;

/**
 * A run of fixes heading `course` degrees at `speedMps`, one per second,
 * ending at `NOW`.
 *
 * `heading` is left null by default so the maths is forced through
 * `initialBearing` unless a test says otherwise.
 */
function leg({ from = { lat: 46.9, lon: 17.9 }, course, speedMps = 3, count = 6, heading = null }) {
  const samples = [{ ...from, accuracy: 5, speed: null, heading, t: NOW - count * 1000 }];
  const rad = (course * Math.PI) / 180;
  // Metres per degree, near enough at Balaton's latitude for a test fixture.
  const mPerDegLat = 111194.93;
  const mPerDegLon = mPerDegLat * Math.cos((from.lat * Math.PI) / 180);

  for (let i = 1; i <= count; i++) {
    const d = speedMps * i;
    samples.push({
      lat: from.lat + (d * Math.cos(rad)) / mPerDegLat,
      lon: from.lon + (d * Math.sin(rad)) / mPerDegLon,
      accuracy: 5,
      speed: null,
      heading,
      t: NOW - (count - i) * 1000,
    });
  }
  return samples;
}

test('a steady course reports that course', () => {
  const result = computeCog(leg({ course: 90 }), { windowMs: 5000, nowT: NOW });
  assert.equal(result.status, 'ok');
  assert.ok(Math.abs(result.cog - 90) < 1, `expected ~90, got ${result.cog}`);
  assert.ok(result.spreadDeg < 2, `expected a tight spread, got ${result.spreadDeg}`);
});

test('averaging wraps around north instead of averaging to south', () => {
  // Legs at 359, 1 and 3 degrees. A scalar mean of the degrees gives 121.
  const first = leg({ course: 359, count: 2 });
  const later = leg({ from: first[first.length - 1], course: 1, count: 2 });
  const latest = leg({ from: later[later.length - 1], course: 3, count: 2 });
  const all = [...first, ...later.slice(1), ...latest.slice(1)]
    .map((s, i, a) => ({ ...s, t: NOW - (a.length - 1 - i) * 1000 }));

  const result = computeCog(all, { windowMs: 10000, nowT: NOW });
  const offNorth = Math.min(result.cog, 360 - result.cog);
  assert.ok(offNorth < 5, `expected a course near north, got ${result.cog}`);
});

test('a boat slower than the threshold reports no course', () => {
  const crawling = leg({ course: 90, speedMps: MIN_SPEED_MPS / 2 });
  const result = computeCog(crawling, { windowMs: 5000, nowT: NOW });
  assert.equal(result.status, 'slow');
  assert.equal(result.cog, null);
});

test('a short noisy leg counts for little against a long steady run', () => {
  // Sixty metres due east, then two fixes of GPS noise a couple of metres
  // north. An unweighted mean of the three courses (90, 0, 0) gives 30
  // degrees; weighting by distance travelled keeps the answer near 90.
  const moving = leg({ course: 90, count: 20 });
  const last = moving[moving.length - 1];
  const noisy = [
    ...moving,
    { ...last, lat: last.lat + 0.00002, t: NOW + 1000 },
    { ...last, lat: last.lat + 0.00004, t: NOW + 2000 },
  ];

  const result = computeCog(noisy, { windowMs: 60000, nowT: NOW + 2000 });
  assert.ok(
    Math.abs(result.cog - 90) < 10,
    `expected the long run to dominate, got ${result.cog}`
  );
});

test('a tack in progress is reported as unsteady', () => {
  const first = leg({ course: 45, count: 4 });
  const second = leg({ from: first[first.length - 1], course: 135, count: 4 });
  const all = [...first, ...second.slice(1)]
    .map((s, i, a) => ({ ...s, t: NOW - (a.length - 1 - i) * 1000 }));

  const result = computeCog(all, { windowMs: 10000, nowT: NOW });
  assert.equal(result.status, 'unsteady');
  assert.ok(result.cog != null, 'an unsteady course is still reported, just flagged');
  assert.ok(result.spreadDeg > 15, `expected a wide spread, got ${result.spreadDeg}`);
});

test('an empty or single-fix buffer reports no fix', () => {
  assert.equal(computeCog([], { windowMs: 5000, nowT: NOW }).status, 'nofix');
  assert.equal(
    computeCog([{ lat: 46.9, lon: 17.9, accuracy: 5, speed: null, heading: null, t: NOW }],
      { windowMs: 5000, nowT: NOW }).status,
    'nofix'
  );
});

test('a buffer of stale fixes reports no fix', () => {
  const old = leg({ course: 90 }).map((s) => ({ ...s, t: s.t - STALE_MS - 1000 }));
  assert.equal(computeCog(old, { windowMs: 5000, nowT: NOW }).status, 'nofix');
});

test('damping off uses only the newest leg', () => {
  const first = leg({ course: 0, count: 4 });
  const second = leg({ from: first[first.length - 1], course: 90, count: 4 });
  const all = [...first, ...second.slice(1)]
    .map((s, i, a) => ({ ...s, t: NOW - (a.length - 1 - i) * 1000 }));

  const result = computeCog(all, { windowMs: 0, nowT: NOW });
  assert.ok(Math.abs(result.cog - 90) < 1, `expected the newest leg only, got ${result.cog}`);
  // A single leg cannot disagree with itself. Not asserted as exactly zero:
  // the resultant length is computed with hypot and lands a hair under one.
  assert.ok(result.spreadDeg < 0.001, `expected no spread, got ${result.spreadDeg}`);
});

test('the device heading is preferred over differencing positions', () => {
  // Positions run due east; the device insists the course is 270. Trusting
  // the device is deliberate: on most chipsets it is Doppler-derived.
  const samples = leg({ course: 90, heading: 270 });
  const result = computeCog(samples, { windowMs: 5000, nowT: NOW });
  assert.ok(Math.abs(result.cog - 270) < 1, `expected the reported heading, got ${result.cog}`);
});

test('positions are differenced when the device reports no heading', () => {
  const samples = leg({ course: 210, heading: null });
  const result = computeCog(samples, { windowMs: 5000, nowT: NOW });
  assert.ok(Math.abs(result.cog - 210) < 1, `expected ~210, got ${result.cog}`);
});
