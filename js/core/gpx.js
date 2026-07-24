/**
 * GPX 1.1 serialisation.
 *
 * Export only. Spec section 11 mentions "export/import", but 6.3 specifies
 * only export, and parsing foreign GPX means absorbing the considerable
 * structural variation between producing apps for no stated need.
 *
 * Pure module: builds and returns a string. Turning that into a file
 * download is the caller's job.
 */

export const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';

const CREATOR = 'Balaton Navigátor';

/** Escape the five XML predefined entities. */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;') // must run first, or later entities get double-escaped
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Epoch milliseconds to an ISO 8601 instant in UTC. */
function isoTime(t) {
  return new Date(t).toISOString();
}

/**
 * Render a recorded track as a GPX 1.1 document.
 *
 * Coordinates are written at full stored precision; GPX consumers round as
 * they see fit, and discarding digits here would be lossy for no gain.
 */
export function trackToGpx(track) {
  const points = track.points ?? [];

  const trkpts = points.map((p) => {
    const parts = [`      <trkpt lat="${p.lat}" lon="${p.lon}">`];
    if (p.t != null) parts.push(`        <time>${isoTime(p.t)}</time>`);
    // GPX has no standard element for horizontal accuracy, so it is dropped
    // rather than smuggled into an element that means something else.
    if (p.speed != null) parts.push(`        <speed>${p.speed}</speed>`);
    parts.push('      </trkpt>');
    return parts.join('\n');
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${esc(CREATOR)}" xmlns="${GPX_NAMESPACE}">
  <metadata>
    <name>${esc(track.name)}</name>
    <time>${isoTime(track.startedAt)}</time>
  </metadata>
  <trk>
    <name>${esc(track.name)}</name>
    <trkseg>
${trkpts.join('\n')}${trkpts.length > 0 ? '\n' : ''}    </trkseg>
  </trk>
</gpx>
`;
}

/** A filesystem-safe filename for a track export. */
export function gpxFilename(track) {
  const safe = String(track.name ?? 'track')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${safe || 'track'}.gpx`;
}
