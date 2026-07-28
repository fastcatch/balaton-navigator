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
import {
  distanceUnit,
  formatBearing,
  formatDistanceValue,
  formatDuration,
  relativeBearing,
} from '../core/geo.js';
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

  // Signed, so the figure reads as a correction to make rather than a course
  // to steer. Unsigned, "12°" under a chevron pointing to port could be read
  // as a bearing of 012 — and 012 is a heading somebody could plausibly be
  // asked to steer, so nothing about the misreading announces itself.
  //
  // Starboard positive, port negative, which is the sign relativeBearing
  // already returns rather than a convention invented here. U+2212 for the
  // minus, matching formatSpeedValue, so a negative turn and a negative VMC
  // are the same glyph two panels apart.
  //
  // No sign at all on zero: "+0°" claims a direction for a correction that
  // has none, and the chevrons have already given up on the distinction by
  // then — lastChevrons is 0 and the glyph is pointing straight up.
  const whole = Math.round(rel);
  const sign = whole > 0 ? '+' : whole < 0 ? '−' : '';

  return el('div', { className: 'nav-turn' }, [
    el('div', { className: 'nav-turn__chevrons', textContent: glyph }),
    el('div', { className: 'nav-turn__degrees', textContent: `${sign}${Math.abs(whole)}°` }),
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
  // Always a fixed-height slot, whatever goes in it.
  //
  // The turn readout is about 100px and the "no course yet" note is a single
  // line, so swapping one for the other moved everything below it — and the
  // map above it — by roughly 68px. Gating the course on reported speed made
  // that swap common at low speed rather than a one-off at startup, and a
  // panel that jumps while you are trying to read it is worse than either
  // state it jumps between. Same reasoning that keeps an unsteady course
  // dimmed rather than hidden; this just applies it to the missing case too.
  const slot = (child) => el('div', { className: 'nav-steer-slot' }, [child]);

  if (cog.cog == null) {
    const note = COG_NOTE[cog.status];
    return slot(note ? el('div', { className: 'nav-cog-note', textContent: note }) : null);
  }

  const rel = relativeBearing(nav.bearing, cog.cog);
  return slot(el('div', {
    className: `nav-steer${cog.status === 'unsteady' ? ' is-unsteady' : ''}`,
  }, [turnReadout(rel), deviationTape(rel)]));
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
      //
      // The caption widens to "Távolság · Idő" rather than gaining a second
      // label element: without it, "1.24 NM  0:18" invites reading 0:18 as a
      // clock time, and the 11px uppercase caption already exists, so this
      // costs zero extra height — which was the entire reason IDŐ went
      // inline instead of onto its own row.
      // The unit rides in the caption too, so the figure is a bare number.
      // Unlike SOG's, this unit is NOT fixed by the setting — it switches from
      // km to m as you close on a mark — so the caption changes with it. That
      // is a real cost, accepted deliberately: it is the only way to fit
      // "105.15" and a time in one column without shrinking the figure, and
      // both parts come from one threshold decision in geo.js so they can
      // never contradict each other.
      figure(
        `Távolság · ${distanceUnit(nav.distance, settings.units)} · Idő`,
        formatDistanceValue(nav.distance, settings.units),
        { sub: instruments.ttgSeconds == null ? '—' : formatDuration(instruments.ttgSeconds) }
      ),
    ]),
    steerBlock(nav, cog),
    el('div', { className: 'nav-target', textContent: `Cél: ${nav.targetName}` }),
  ]);
}
