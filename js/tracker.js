/**
 * Track recording.
 *
 * Two things make this more than an array push:
 *
 * 1. Writes are buffered. A five-hour passage at 1 Hz is ~18,000 points, and
 *    rewriting that array on every fix is quadratic. Points flush every
 *    FLUSH_EVERY_POINTS or FLUSH_INTERVAL_MS, and whenever the page is hidden.
 *
 * 2. iOS suspends JavaScript when the screen locks, so `watchPosition` simply
 *    stops. There is no background geolocation for a PWA. A screen wake lock
 *    is requested to delay that, and gaps are marked rather than papered over.
 */

import { STORE_TRACKS, put } from './storage.js';
import { createTrack } from './core/model.js';

const FLUSH_EVERY_POINTS = 20;
const FLUSH_INTERVAL_MS = 15000;

export function createTracker({ onChange } = {}) {
  let track = null;
  let pending = [];
  let flushTimer = null;
  let wakeLock = null;

  async function acquireWakeLock() {
    if (!navigator.wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      // The lock is dropped whenever the page is hidden, so it has to be
      // re-taken on every return to the foreground, not just once.
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null; // denied or unsupported; recording still works
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLock?.release();
    } catch {
      /* already gone */
    }
    wakeLock = null;
  }

  async function flush() {
    if (!track || pending.length === 0) return;
    track.points.push(...pending);
    track.pointCount = track.points.length;
    pending = [];
    await put(STORE_TRACKS, track);
  }

  function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = setInterval(() => {
      flush();
    }, FLUSH_INTERVAL_MS);
  }

  function stopFlushTimer() {
    if (flushTimer !== null) clearInterval(flushTimer);
    flushTimer = null;
  }

  /** Re-take the wake lock after the page comes back to the foreground. */
  async function handleVisibility() {
    if (!track) return;
    if (document.visibilityState === 'hidden') {
      await flush(); // the app may not get another chance to write
    } else if (!wakeLock) {
      await acquireWakeLock();
    }
  }

  document.addEventListener('visibilitychange', handleVisibility);

  return {
    get track() {
      return track;
    },

    get isRecording() {
      return track !== null;
    },

    /** All points written so far, including the unflushed buffer. */
    get points() {
      return track ? [...track.points, ...pending] : [];
    },

    async start({ name, routeId, keepAwake } = {}) {
      if (track) return track;
      track = createTrack({ name, routeId });
      pending = [];
      await put(STORE_TRACKS, track);
      if (keepAwake !== false) await acquireWakeLock();
      scheduleFlush();
      onChange?.();
      return track;
    },

    /** Resume a recording interrupted by a reload or a discarded tab. */
    async resume(existingTrack, { keepAwake } = {}) {
      track = existingTrack;
      track.points ??= [];
      pending = [];
      if (keepAwake !== false) await acquireWakeLock();
      scheduleFlush();
      onChange?.();
      return track;
    },

    /**
     * Record a fix. Points less precise than `minAccuracyM` are dropped
     * (spec 6.3) — a 200 m fix would draw a track through the shoreline.
     */
    addPoint(position, settings) {
      if (!track || !position) return false;
      if (position.accuracy != null && position.accuracy > settings.minAccuracyM) {
        return false;
      }

      pending.push({
        lat: position.lat,
        lon: position.lon,
        t: position.t ?? Date.now(),
        ...(position.accuracy != null ? { accuracy: position.accuracy } : {}),
        ...(position.speed != null ? { speed: position.speed } : {}),
      });

      if (pending.length >= FLUSH_EVERY_POINTS) flush();
      onChange?.();
      return true;
    },

    async stop() {
      if (!track) return null;
      await flush();
      track.endedAt = Date.now();
      track.pointCount = track.points.length;
      await put(STORE_TRACKS, track);
      stopFlushTimer();
      await releaseWakeLock();
      const finished = track;
      track = null;
      onChange?.();
      return finished;
    },

    dispose() {
      stopFlushTimer();
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibility);
    },
  };
}
