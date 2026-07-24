import test from 'node:test';
import assert from 'node:assert/strict';

import {
  haversine,
  initialBearing,
  relativeBearing,
  destinationPoint,
  magneticToTrue,
  formatDistance,
  formatBearing,
  simplify,
  EARTH_RADIUS_M,
} from '../js/core/geo.js';

// ---------------------------------------------------------------------------
// Distance — analytic cases
//
// On a sphere of radius R, one degree of arc is R * pi / 180.
// With R = 6371000 m that is 111194.93 m, verifiable by hand.
// ---------------------------------------------------------------------------

const ONE_DEGREE_M = (EARTH_RADIUS_M * Math.PI) / 180;

test('one degree of latitude along a meridian is one degree of arc', () => {
  const d = haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - ONE_DEGREE_M) < 0.5, `expected ~${ONE_DEGREE_M}, got ${d}`);
});

test('one degree of longitude at the equator is one degree of arc', () => {
  const d = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(d - ONE_DEGREE_M) < 0.5, `expected ~${ONE_DEGREE_M}, got ${d}`);
});

test('one degree of longitude at 60N is half a degree of arc', () => {
  // cos(60) = 0.5 exactly, so the parallel is half the length of the equator.
  const d = haversine({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });
  assert.ok(Math.abs(d - ONE_DEGREE_M / 2) < 1, `expected ~${ONE_DEGREE_M / 2}, got ${d}`);
});

test('distance to the same point is zero', () => {
  assert.equal(haversine({ lat: 46.9, lon: 17.9 }, { lat: 46.9, lon: 17.9 }), 0);
});

test('distance is symmetric', () => {
  const a = { lat: 46.9483, lon: 17.8869 };
  const b = { lat: 46.9067, lon: 18.0483 };
  assert.ok(Math.abs(haversine(a, b) - haversine(b, a)) < 1e-6);
});

// Published reference: Land's End to John o' Groats.
// movable-type.co.uk/scripts/latlong.html gives 968.9 km, initial bearing 009 deg 07' 11".
const LANDS_END = { lat: 50.066389, lon: -5.714722 };
const JOHN_O_GROATS = { lat: 58.643889, lon: -3.07 };

test('matches the published Land’s End to John o’ Groats distance', () => {
  const km = haversine(LANDS_END, JOHN_O_GROATS) / 1000;
  assert.ok(Math.abs(km - 968.9) < 0.5, `expected ~968.9 km, got ${km.toFixed(2)} km`);
});

test('matches the published Land’s End to John o’ Groats initial bearing', () => {
  const deg = initialBearing(LANDS_END, JOHN_O_GROATS);
  const expected = 9 + 7 / 60 + 11 / 3600; // 009 deg 07' 11"
  assert.ok(Math.abs(deg - expected) < 0.01, `expected ~${expected}, got ${deg}`);
});

test('agrees with the spherical law of cosines at Balaton scale', () => {
  // An independent formula. The two disagree only for antipodal or
  // sub-metre separations, neither of which occurs here.
  const lawOfCosines = (a, b) => {
    const r = (d) => (d * Math.PI) / 180;
    return (
      Math.acos(
        Math.sin(r(a.lat)) * Math.sin(r(b.lat)) +
          Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon))
      ) * EARTH_RADIUS_M
    );
  };
  const pairs = [
    [{ lat: 46.9483, lon: 17.8869 }, { lat: 46.895, lon: 17.8878 }],
    [{ lat: 46.9067, lon: 18.0483 }, { lat: 46.755, lon: 17.245 }],
    [{ lat: 46.71, lon: 17.25 }, { lat: 47.02, lon: 18.15 }],
  ];
  for (const [a, b] of pairs) {
    assert.ok(
      Math.abs(haversine(a, b) - lawOfCosines(a, b)) < 1,
      `haversine and law of cosines disagree by more than 1 m for ${JSON.stringify(a)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Bearing
// ---------------------------------------------------------------------------

test('due north is 0 degrees', () => {
  assert.ok(Math.abs(initialBearing({ lat: 46, lon: 17 }, { lat: 47, lon: 17 })) < 1e-9);
});

test('due south is 180 degrees', () => {
  assert.ok(Math.abs(initialBearing({ lat: 47, lon: 17 }, { lat: 46, lon: 17 }) - 180) < 1e-9);
});

test('due east along the equator is 90 degrees', () => {
  assert.ok(Math.abs(initialBearing({ lat: 0, lon: 17 }, { lat: 0, lon: 18 }) - 90) < 1e-9);
});

test('due west along the equator is 270 degrees', () => {
  assert.ok(Math.abs(initialBearing({ lat: 0, lon: 18 }, { lat: 0, lon: 17 }) - 270) < 1e-9);
});

test('bearing is always normalised to 0..360', () => {
  const pts = [
    { lat: 46.9, lon: 17.9 },
    { lat: 47.1, lon: 17.7 },
    { lat: 46.7, lon: 18.2 },
    { lat: 46.8, lon: 17.2 },
  ];
  for (const a of pts) {
    for (const b of pts) {
      const deg = initialBearing(a, b);
      assert.ok(deg >= 0 && deg < 360, `bearing out of range: ${deg}`);
    }
  }
});

test('reciprocal bearings differ by roughly 180 degrees over short distances', () => {
  const a = { lat: 46.9483, lon: 17.8869 };
  const b = { lat: 46.895, lon: 17.8878 };
  const diff = Math.abs(initialBearing(a, b) - initialBearing(b, a));
  assert.ok(Math.abs(diff - 180) < 0.1, `expected ~180, got ${diff}`);
});

// ---------------------------------------------------------------------------
// Relative bearing — what the on-screen arrow points at
// ---------------------------------------------------------------------------

test('relative bearing is zero when heading straight at the target', () => {
  assert.equal(relativeBearing(90, 90), 0);
});

test('relative bearing is positive when the target is to starboard', () => {
  assert.equal(relativeBearing(90, 0), 90);
});

test('relative bearing is negative when the target is to port', () => {
  assert.equal(relativeBearing(0, 90), -90);
});

test('relative bearing takes the short way round north', () => {
  assert.equal(relativeBearing(350, 10), -20);
  assert.equal(relativeBearing(10, 350), 20);
});

test('relative bearing stays within -180..180', () => {
  for (let target = 0; target < 360; target += 7) {
    for (let heading = 0; heading < 360; heading += 11) {
      const rel = relativeBearing(target, heading);
      assert.ok(rel > -180.0001 && rel <= 180.0001, `out of range: ${rel}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Destination point — used to draw the heading ray out to the horizon
// ---------------------------------------------------------------------------

test('travelling zero distance stays put', () => {
  const from = { lat: 46.9483, lon: 17.8869 };
  const to = destinationPoint(from, 123, 0);
  assert.ok(Math.abs(to.lat - from.lat) < 1e-12);
  assert.ok(Math.abs(to.lon - from.lon) < 1e-12);
});

test('travelling due north increases latitude by the arc travelled', () => {
  const to = destinationPoint({ lat: 46, lon: 17 }, 0, ONE_DEGREE_M);
  assert.ok(Math.abs(to.lat - 47) < 1e-6, `expected 47, got ${to.lat}`);
  assert.ok(Math.abs(to.lon - 17) < 1e-9);
});

test('travelling due south decreases latitude by the arc travelled', () => {
  const to = destinationPoint({ lat: 46, lon: 17 }, 180, ONE_DEGREE_M);
  assert.ok(Math.abs(to.lat - 45) < 1e-6, `expected 45, got ${to.lat}`);
});

test('travelling due east along the equator increases longitude', () => {
  const to = destinationPoint({ lat: 0, lon: 17 }, 90, ONE_DEGREE_M);
  assert.ok(Math.abs(to.lat) < 1e-9, `should stay on the equator, got ${to.lat}`);
  assert.ok(Math.abs(to.lon - 18) < 1e-6, `expected 18, got ${to.lon}`);
});

test('matches the published destination-point worked example', () => {
  // movable-type.co.uk/scripts/latlong.html:
  // 53 19' 14"N, 001 43' 47"W  bearing 096 01' 18"  distance 124.8 km
  //   -> 53 11' 18"N, 000 08' 00"E
  const to = destinationPoint(
    { lat: 53.32055556, lon: -1.72972222 },
    96.02166667,
    124800
  );
  assert.ok(Math.abs(to.lat - 53.18833) < 0.001, `expected ~53.18833, got ${to.lat}`);
  assert.ok(Math.abs(to.lon - 0.13333) < 0.001, `expected ~0.13333, got ${to.lon}`);
});

test('the destination is exactly the requested distance away', () => {
  const from = { lat: 46.9483, lon: 17.8869 };
  for (const bearing of [0, 45, 137, 250, 359]) {
    for (const distance of [10, 1000, 50000]) {
      const to = destinationPoint(from, bearing, distance);
      assert.ok(
        Math.abs(haversine(from, to) - distance) < 0.01,
        `bearing ${bearing}, distance ${distance}: got ${haversine(from, to)}`
      );
    }
  }
});

test('the destination lies on exactly the requested bearing', () => {
  const from = { lat: 46.9483, lon: 17.8869 };
  for (const bearing of [0, 45, 137, 250, 359]) {
    const to = destinationPoint(from, bearing, 20000);
    const back = initialBearing(from, to);
    assert.ok(
      Math.abs(relativeBearing(back, bearing)) < 1e-6,
      `expected bearing ${bearing}, got ${back}`
    );
  }
});

test('longitude stays within -180..180 when crossing the antimeridian', () => {
  // Not reachable on Balaton, but an unwrapped longitude would send Leaflet
  // drawing a line the whole way round the world.
  const to = destinationPoint({ lat: 0, lon: 179.5 }, 90, ONE_DEGREE_M);
  assert.ok(to.lon >= -180 && to.lon <= 180, `longitude out of range: ${to.lon}`);
  assert.ok(to.lon < 0, `expected a wrap to negative longitude, got ${to.lon}`);
});

// ---------------------------------------------------------------------------
// Magnetic to true north
//
// Every heading source on this platform reports magnetic north, while every
// bearing computed from coordinates is true. Mixing them puts the compass
// arrow, the view cone and the sight line consistently off by the local
// declination.
// ---------------------------------------------------------------------------

test('east declination is added to the magnetic heading', () => {
  // Declination east means true north lies east of magnetic north, so a
  // given magnetic reading corresponds to a larger true bearing.
  assert.equal(magneticToTrue(0, 5), 5);
  assert.equal(magneticToTrue(90, 5), 95);
  assert.equal(magneticToTrue(180, 5), 185);
});

test('west declination is subtracted from the magnetic heading', () => {
  assert.equal(magneticToTrue(90, -5), 85);
  assert.equal(magneticToTrue(10, -5), 5);
});

test('zero declination leaves the heading unchanged', () => {
  for (const h of [0, 47, 180, 359]) assert.equal(magneticToTrue(h, 0), h);
});

test('the result wraps past north rather than exceeding 360', () => {
  assert.equal(magneticToTrue(357, 5), 2);
  assert.equal(magneticToTrue(359.5, 5), 4.5);
});

test('the result wraps below north rather than going negative', () => {
  assert.equal(magneticToTrue(2, -5), 357);
  assert.equal(magneticToTrue(0, -5), 355);
});

test('the result is always a valid bearing', () => {
  for (let h = 0; h < 360; h += 7) {
    for (const dec of [-20, -5, 0, 5, 20]) {
      const t = magneticToTrue(h, dec);
      assert.ok(t >= 0 && t < 360, `out of range: ${t} from ${h} with ${dec}`);
    }
  }
});

test('converting to true and back recovers the magnetic heading', () => {
  for (let h = 0; h < 360; h += 11) {
    const roundTrip = magneticToTrue(magneticToTrue(h, 5), -5);
    assert.ok(Math.abs(roundTrip - h) < 1e-9, `expected ${h}, got ${roundTrip}`);
  }
});

// ---------------------------------------------------------------------------
// Formatting — the unified rule from the design doc, section 3
// ---------------------------------------------------------------------------

test('metric distances under 1 km render as whole metres', () => {
  assert.equal(formatDistance(0, 'metric'), '0 m');
  assert.equal(formatDistance(340, 'metric'), '340 m');
  assert.equal(formatDistance(340.6, 'metric'), '341 m');
  assert.equal(formatDistance(999.4, 'metric'), '999 m');
});

test('metric distances of 1 km and above render as kilometres to two decimals', () => {
  assert.equal(formatDistance(1000, 'metric'), '1.00 km');
  assert.equal(formatDistance(2310, 'metric'), '2.31 km');
  assert.equal(formatDistance(23456, 'metric'), '23.46 km');
});

test('nautical distances under half a mile render as whole metres', () => {
  assert.equal(formatDistance(340, 'nautical'), '340 m');
  assert.equal(formatDistance(925, 'nautical'), '925 m'); // 0.4995 NM
});

test('nautical distances of half a mile and above render as nautical miles', () => {
  assert.equal(formatDistance(926, 'nautical'), '0.50 NM'); // exactly 0.5 NM
  assert.equal(formatDistance(1852, 'nautical'), '1.00 NM');
  assert.equal(formatDistance(2297, 'nautical'), '1.24 NM');
});

test('bearings render as three zero-padded degrees', () => {
  assert.equal(formatBearing(0), '000°');
  assert.equal(formatBearing(7), '007°');
  assert.equal(formatBearing(47), '047°');
  assert.equal(formatBearing(134), '134°');
  assert.equal(formatBearing(134.4), '134°');
  assert.equal(formatBearing(134.6), '135°');
});

test('a bearing rounding up to 360 renders as 000', () => {
  assert.equal(formatBearing(359.7), '000°');
  assert.equal(formatBearing(360), '000°');
});

// ---------------------------------------------------------------------------
// Douglas-Peucker simplification
// ---------------------------------------------------------------------------

test('simplify returns short inputs unchanged', () => {
  assert.deepEqual(simplify([], 10), []);
  const one = [{ lat: 46.9, lon: 17.9 }];
  assert.deepEqual(simplify(one, 10), one);
  const two = [{ lat: 46.9, lon: 17.9 }, { lat: 46.91, lon: 17.9 }];
  assert.deepEqual(simplify(two, 10), two);
});

test('simplify drops points lying on a straight line', () => {
  const line = [
    { lat: 46.9, lon: 17.9 },
    { lat: 46.91, lon: 17.9 },
    { lat: 46.92, lon: 17.9 },
    { lat: 46.93, lon: 17.9 },
  ];
  assert.deepEqual(simplify(line, 10), [line[0], line[3]]);
});

test('simplify keeps a point that deviates further than epsilon', () => {
  // The middle point sits ~760 m east of the straight line.
  const bend = [
    { lat: 46.9, lon: 17.9 },
    { lat: 46.91, lon: 17.91 },
    { lat: 46.92, lon: 17.9 },
  ];
  assert.equal(simplify(bend, 100).length, 3);
});

test('simplify drops a deviation smaller than epsilon', () => {
  const bend = [
    { lat: 46.9, lon: 17.9 },
    { lat: 46.91, lon: 17.91 },
    { lat: 46.92, lon: 17.9 },
  ];
  assert.equal(simplify(bend, 2000).length, 2);
});

test('simplify always preserves the first and last points', () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({
    lat: 46.9 + i * 0.001,
    lon: 17.9 + Math.sin(i) * 0.0001,
  }));
  const out = simplify(pts, 500);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
  assert.ok(out.length < pts.length);
});

test('simplify preserves the shape of a right-angle turn', () => {
  // A leg north then a leg east. The corner must survive: this is the
  // case that "render every Nth point" degrades and Douglas-Peucker does not.
  const leg = [];
  for (let i = 0; i <= 10; i++) leg.push({ lat: 46.9 + i * 0.002, lon: 17.9 });
  for (let i = 1; i <= 10; i++) leg.push({ lat: 46.92, lon: 17.9 + i * 0.002 });
  const out = simplify(leg, 50);
  assert.equal(out.length, 3);
  assert.deepEqual(out[1], { lat: 46.92, lon: 17.9 });
});
