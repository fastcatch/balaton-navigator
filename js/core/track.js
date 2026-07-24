/**
 * Turning a raw point list into something drawable.
 *
 * Pure module. Raw track data is never modified — everything here shapes only
 * what gets rendered.
 */

import { simplify } from './geo.js';

/**
 * A pause longer than this is treated as a gap in the record rather than a
 * leg that was sailed. Comfortably longer than any plausible GPS hiccup, and
 * short enough to catch a locked screen.
 */
export const GAP_THRESHOLD_MS = 60000;

/** Ground resolution in metres per pixel at Balaton's latitude (~46.9 N). */
const METRES_PER_PIXEL_Z0 = 156543.03 * Math.cos((46.9 * Math.PI) / 180);

/** Default ceiling on rendered points, across all segments. */
const DEFAULT_MAX_POINTS = 2000;

/**
 * Hard ceiling on how many points Douglas-Peucker is ever handed.
 *
 * Douglas-Peucker is O(n log n) on well-behaved data but degrades to O(n^2)
 * when many points share the same maximum deviation — a regular zigzag makes
 * every split maximally uneven. Measured: 8000 such points take ~0.7 s, and
 * 30,000 take minutes. Uniformly thinning first bounds the work regardless of
 * what the data looks like.
 */
const DP_INPUT_LIMIT = 4000;

/**
 * Split a point list wherever recording stopped for longer than the
 * threshold, so the map draws separate lines instead of one straight leg
 * across the interruption.
 *
 * This is the visible consequence of the iOS suspension limitation: when the
 * screen locks, points stop arriving. Bridging the gap with a straight line
 * would assert a course that was never sailed.
 */
export function splitOnGaps(points, thresholdMs = GAP_THRESHOLD_MS) {
  if (points.length === 0) return [];

  const segments = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > thresholdMs) segments.push([]);
    segments[segments.length - 1].push(points[i]);
  }
  return segments;
}

/**
 * Simplification tolerance for a zoom level: detail finer than about a
 * pixel and a half cannot be seen, so discarding it costs nothing.
 */
export function epsilonForZoom(zoom) {
  return (METRES_PER_PIXEL_Z0 / 2 ** zoom) * 1.5;
}

/**
 * Evenly thin a point list to at most `target` points, always keeping the
 * first and the last.
 */
function decimate(points, target) {
  if (target < 2 || points.length <= target) return points.slice();

  const step = (points.length - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Thin a set of segments to `target` points total, shared out by length. */
function decimateSegments(segments, target) {
  const total = segments.reduce((n, seg) => n + seg.length, 0);
  if (total <= target) return segments;

  return segments.map((seg) =>
    decimate(seg, Math.max(2, Math.floor((target * seg.length) / total)))
  );
}

const countPoints = (segments) => segments.reduce((n, seg) => n + seg.length, 0);

/**
 * Prepare a track for drawing: split on gaps, simplify each segment for the
 * current zoom, and hold the total under `maxPoints`.
 *
 * Three stages, in order of how much shape they preserve:
 *
 *   1. Thin uniformly if the raw list is large enough to make simplification
 *      itself expensive. Bounds the work; costs a little fidelity on very
 *      long tracks.
 *   2. Douglas-Peucker at a tolerance matched to the zoom. This is the stage
 *      that preserves tacking corners.
 *   3. Thin uniformly again if the line is still too dense. Only reached when
 *      the track genuinely has more corners than pixels — a long beat to
 *      windward is all corners, and every one of them is real.
 *
 * The raw data is never touched; this shapes only what is drawn.
 */
export function renderableSegments(points, zoom, maxPoints = DEFAULT_MAX_POINTS) {
  let segments = splitOnGaps(points);
  if (segments.length === 0) return [];

  segments = decimateSegments(segments, DP_INPUT_LIMIT);

  const epsilon = epsilonForZoom(zoom);
  segments = segments.map((seg) => simplify(seg, epsilon));

  if (countPoints(segments) > maxPoints) {
    segments = decimateSegments(segments, maxPoints);
  }

  return segments;
}
