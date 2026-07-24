/**
 * Track history (spec 6.3): review a recorded passage, export it, delete it.
 */

import { el, iconButton, empty } from './dom.js';
import { haversine, formatDistance } from '../core/geo.js';
import { splitOnGaps } from '../core/track.js';

/** Total distance sailed, summed along the track and skipping gaps. */
function trackDistance(points) {
  let total = 0;
  for (const segment of splitOnGaps(points)) {
    for (let i = 1; i < segment.length; i++) {
      total += haversine(segment[i - 1], segment[i]);
    }
  }
  return total;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ó ${m} p` : `${m} p`;
}

function summary(track, units) {
  const points = track.points ?? [];
  if (points.length === 0) return 'Nincs rögzített pont';

  const ended = track.endedAt ?? points.at(-1).t;
  const parts = [
    formatDistance(trackDistance(points), units),
    formatDuration(ended - track.startedAt),
    `${points.length} pont`,
  ];

  const gaps = splitOnGaps(points).length - 1;
  // Worth surfacing: a gap means the screen locked and the app was suspended,
  // not that the boat teleported.
  if (gaps > 0) parts.push(`${gaps} megszakítás`);

  return parts.join(' · ');
}

export function renderTracksView({ tracks, shownTrackId, settings, actions }) {
  if (tracks.length === 0) {
    return [empty('Még nincs rögzített útvonal. Indíts rögzítést a főképernyőn.')];
  }

  const sorted = [...tracks].sort((a, b) => b.startedAt - a.startedAt);

  return [
    el(
      'ul',
      { className: 'list' },
      sorted.map((track) =>
        el('li', { className: track.id === shownTrackId ? 'is-active' : '' }, [
          el('button', {
            className: 'grow row-button',
            type: 'button',
            onClick: () => actions.onShowTrack(track),
          }, [
            el('div', { className: 'title', textContent: track.name }),
            el('div', { className: 'sub', textContent: summary(track, settings.units) }),
            track.endedAt === null
              ? el('div', { className: 'sub', textContent: '● Rögzítés folyamatban', style: 'color:var(--danger)' })
              : null,
          ]),
          iconButton('⤓', () => actions.onExportTrack(track)),
          iconButton('✕', () => actions.onDeleteTrack(track), 'icon-btn--danger'),
        ])
      )
    ),

    el('div', {
      className: 'note',
      textContent:
        'A ⤓ gomb GPX fájlként menti a track-et, amit más navigációs appok is meg tudnak nyitni.',
    }),
  ];
}
