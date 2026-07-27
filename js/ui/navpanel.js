/**
 * The navigation readout: bearing, distance, target, and how far to turn.
 *
 * This is the one part of the UI that has to be readable at arm's length in
 * glare, so it is deliberately sparse — and wordless where it can be. At six
 * knots in chop nobody reads a label, so the turn is shown as chevrons and a
 * number, with no BALRA/JOBBRA text to parse.
 *
 * The turn is measured against course over ground, never against the compass.
 * A compass reading only means something if the phone is aligned with the
 * boat's axis, which is exactly what is impractical while racing.
 */

import { el, figure, replace } from './dom.js';
import { formatBearing, formatDistance, formatDuration, relativeBearing } from '../core/geo.js';
import { chevronCount } from '../core/cog.js';

/** Full-scale deflection of the deviation tape, in degrees either side. */
const TAPE_RANGE_DEG = 45;

/** Tick every five degrees; the centre and the two thirds-marks stand taller. */
const TAPE_TICKS_DEG = [];
for (let deg = -TAPE_RANGE_DEG; deg <= TAPE_RANGE_DEG; deg += 5) TAPE_TICKS_DEG.push(deg);
const MAJOR_TICKS_DEG = new Set([-30, 0, 30]);

/** Why the turn readout is missing, when it is. */
const COG_NOTE = {
  slow: 'Túl lassú a haladási irányhoz',
  nofix: 'Nincs még elég GPS-adat a haladási irányhoz',
};

/**
 * How many chevrons were drawn last time.
 *
 * Module-level because the panel is rebuilt from scratch on every render and
 * has nowhere else to keep it. `chevronCount` needs it to apply hysteresis —
 * without it an error hovering on a band boundary flickers between one and
 * two chevrons several times a second, which reads as a fault.
 */
let lastChevrons = 0;

/** Chevrons and the degree count: the two things actually read at a glance. */
function turnReadout(rel) {
  const abs = Math.abs(rel);
  lastChevrons = chevronCount(abs, lastChevrons);

  // On course points up rather than to a side, so noise around zero does not
  // swing the display between port and starboard.
  const glyph = lastChevrons === 0 ? '⬆' : (rel < 0 ? '◀' : '▶').repeat(lastChevrons);

  return el('div', { className: 'nav-turn' }, [
    el('div', { className: 'nav-turn__chevrons', textContent: glyph }),
    el('div', { className: 'nav-turn__degrees', textContent: `${Math.round(abs)}°` }),
  ]);
}

/**
 * Deviation tape: ticks for scale, a marker for the error.
 *
 * Linear to ±45 degrees and pegged beyond, which puts the resolution where
 * the helm is actually being trimmed. A mark 120 degrees away is already
 * answered by the digits above, so there is nothing to gain from a scale that
 * reaches it and a lot of precision to lose.
 */
function deviationTape(rel) {
  const clamped = Math.max(-TAPE_RANGE_DEG, Math.min(TAPE_RANGE_DEG, rel));
  const pegged = Math.abs(rel) > TAPE_RANGE_DEG;
  const position = (deg) => `left: ${50 + (deg / TAPE_RANGE_DEG) * 50}%`;

  const ticks = TAPE_TICKS_DEG.map((deg) =>
    el('div', {
      className: `nav-tape__tick${MAJOR_TICKS_DEG.has(deg) ? ' nav-tape__tick--major' : ''}`,
      style: position(deg),
    })
  );

  return el('div', { className: `nav-tape${pegged ? ' nav-tape--pegged' : ''}` }, [
    ...ticks,
    el('div', { className: 'nav-tape__marker', style: position(clamped) }),
  ]);
}

/**
 * The turn block, or a short note saying why there isn't one.
 *
 * An unsteady course — mid-tack, or a noisy fix — is dimmed rather than
 * hidden. Removing it would make the panel jump; dimming says "this is not
 * settled yet" without taking the number away.
 */
function steerBlock(nav, cog) {
  if (cog.cog == null) {
    const note = COG_NOTE[cog.status];
    return note ? el('div', { className: 'nav-cog-note', textContent: note }) : null;
  }

  const rel = relativeBearing(nav.bearing, cog.cog);
  return el('div', {
    className: `nav-steer${cog.status === 'unsteady' ? ' is-unsteady' : ''}`,
  }, [turnReadout(rel), deviationTape(rel)]);
}

export function renderNavPanel(container, { nav, cog, instruments, settings }) {
  // Nothing to steer towards. Say so plainly rather than showing zeroes,
  // which would read as a real bearing (spec 8).
  if (nav.routeComplete) {
    return replace(container, el('div', { className: 'nav-message', textContent: '⚑ Cél elérve' }));
  }
  if (!nav.hasTarget) {
    return replace(container, el('div', { className: 'nav-message', textContent: 'Nincs kijelölt cél' }));
  }
  if (nav.distance == null) {
    return replace(container, [
      el('div', { className: 'nav-message', textContent: 'Várakozás GPS-jelre…' }),
      el('div', { className: 'nav-target', textContent: `Cél: ${nav.targetName}` }),
    ]);
  }

  return replace(container, [
    el('div', { className: 'nav-grid' }, [
      figure('Irányszög', formatBearing(nav.bearing)),
      // Time to go rides with the distance because it is the same question
      // asked in the other unit. It is derived from VMC, so it means "at
      // this rate of closing" — and reads as an em dash when the boat is
      // sailing away, which has no arrival time at all.
      figure('Távolság', formatDistance(nav.distance, settings.units), {
        sub: instruments.ttgSeconds == null ? '—' : formatDuration(instruments.ttgSeconds),
      }),
    ]),
    steerBlock(nav, cog),
    el('div', { className: 'nav-target', textContent: `Cél: ${nav.targetName}` }),
  ]);
}
