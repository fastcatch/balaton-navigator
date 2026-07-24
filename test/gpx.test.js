import test from 'node:test';
import assert from 'node:assert/strict';

import { trackToGpx, GPX_NAMESPACE } from '../js/core/gpx.js';

const TRACK = {
  id: 't1',
  name: 'Füred – Tihany',
  startedAt: Date.UTC(2026, 6, 24, 8, 30, 0),
  endedAt: Date.UTC(2026, 6, 24, 11, 15, 0),
  points: [
    { lat: 46.9483, lon: 17.8869, t: Date.UTC(2026, 6, 24, 8, 30, 0), accuracy: 5, speed: 2.1 },
    { lat: 46.9401, lon: 17.8871, t: Date.UTC(2026, 6, 24, 8, 31, 0), accuracy: 6 },
    { lat: 46.895, lon: 17.8878, t: Date.UTC(2026, 6, 24, 8, 32, 0) },
  ],
};

test('output declares itself as XML and uses the GPX 1.1 namespace', () => {
  const gpx = trackToGpx(TRACK);
  assert.match(gpx, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(gpx.includes(`xmlns="${GPX_NAMESPACE}"`));
  assert.ok(gpx.includes('version="1.1"'));
  assert.match(gpx, /creator="[^"]+"/);
});

test('output carries the track name and a single track segment', () => {
  const gpx = trackToGpx(TRACK);
  assert.ok(gpx.includes('<name>Füred – Tihany</name>'));
  assert.equal(gpx.match(/<trk>/g).length, 1);
  assert.equal(gpx.match(/<trkseg>/g).length, 1);
  assert.ok(gpx.trimEnd().endsWith('</gpx>'));
});

test('every track point is emitted with its coordinates', () => {
  const gpx = trackToGpx(TRACK);
  assert.equal(gpx.match(/<trkpt /g).length, 3);
  assert.ok(gpx.includes('lat="46.9483"'));
  assert.ok(gpx.includes('lon="17.8869"'));
  assert.ok(gpx.includes('lat="46.895"'));
});

test('timestamps are emitted as ISO 8601 in UTC', () => {
  const gpx = trackToGpx(TRACK);
  assert.ok(gpx.includes('<time>2026-07-24T08:30:00.000Z</time>'));
  assert.ok(gpx.includes('<time>2026-07-24T08:32:00.000Z</time>'));
});

test('speed is emitted only for points that have it', () => {
  const gpx = trackToGpx(TRACK);
  assert.equal(gpx.match(/<speed>/g).length, 1);
  assert.ok(gpx.includes('<speed>2.1</speed>'));
});

test('special characters in the track name are XML-escaped', () => {
  const gpx = trackToGpx({ ...TRACK, name: 'Wind & <Waves> "gusty" \'day\'' });
  assert.ok(gpx.includes('Wind &amp; &lt;Waves&gt; &quot;gusty&quot; &apos;day&apos;'));
  // The escaped form must not reintroduce a raw delimiter.
  assert.ok(!gpx.includes('<Waves>'));
});

test('an ampersand in the name is not double-escaped', () => {
  const gpx = trackToGpx({ ...TRACK, name: 'A & B' });
  assert.ok(gpx.includes('A &amp; B'));
  assert.ok(!gpx.includes('&amp;amp;'));
});

test('a track with no points still produces valid GPX', () => {
  const gpx = trackToGpx({ ...TRACK, points: [] });
  assert.ok(gpx.includes('<trkseg>'));
  assert.ok(gpx.includes('</trkseg>'));
  assert.ok(!gpx.includes('<trkpt'));
  assert.ok(gpx.trimEnd().endsWith('</gpx>'));
});

test('no raw unescaped ampersands survive into the output', () => {
  const gpx = trackToGpx({ ...TRACK, name: 'a & b & c' });
  // Every & must begin a character entity.
  for (const match of gpx.matchAll(/&(?!(amp|lt|gt|quot|apos);)/g)) {
    assert.fail(`unescaped ampersand at index ${match.index}`);
  }
});

test('tags are balanced', () => {
  const gpx = trackToGpx(TRACK);
  const opens = [...gpx.matchAll(/<([a-z]+)(?:\s[^>]*)?(?<!\/)>/g)].map((m) => m[1]);
  const closes = [...gpx.matchAll(/<\/([a-z]+)>/g)].map((m) => m[1]);
  const selfClosing = [...gpx.matchAll(/<([a-z]+)[^>]*\/>/g)].map((m) => m[1]);
  const stack = [];
  for (const tag of opens) {
    if (selfClosing.includes(tag)) continue;
    stack.push(tag);
  }
  assert.equal(stack.length, closes.length, 'open and close tag counts differ');
});
