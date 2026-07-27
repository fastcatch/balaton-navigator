/**
 * Two-page horizontal pager: the chart, and the data page.
 *
 * The swipe is bound to the panels, never to the map, because Leaflet claims
 * horizontal drags on the map for panning. Sharing that gesture would mean
 * disabling map dragging mid-drag on a guess about intent, and guessing
 * wrong either eats a pan or eats a page turn.
 *
 * Pointer events rather than touch events: one code path for finger, mouse
 * and stylus across iOS Safari and Chrome on Android, and exercisable with a
 * mouse during development. Binding both models was considered and rejected
 * — a single touch fires touchend *and* pointerup, so the page would turn
 * twice. The floor is not a concern: this app already needs Safari 15.4 for
 * crypto.randomUUID, and pointer events landed in Safari 13 and Chrome 55.
 */

import { el, replace } from './dom.js';

/** Travel before a drag counts as a page change rather than a tap. */
const SWIPE_MIN_PX = 60;

/** How much more horizontal than vertical the travel must be. */
const SWIPE_RATIO = 2;

const PAGES = ['map', 'data'];

export function createPager({ surfaces, dots, onChange }) {
  let page = 0;
  let start = null;

  /**
   * The dots are built once and only ever restyled.
   *
   * They are buttons, and iOS synthesises a click only when pointerdown and
   * pointerup land on the same element. Rebuilding them on a GPS fix would
   * silently stop them working on the one device this app is for, while
   * behaving perfectly on a desktop where no fixes arrive. This is the same
   * failure test/render-cadence.test.js exists to prevent.
   */
  const buttons = PAGES.map((name, index) =>
    el('button', {
      type: 'button',
      className: 'pagedot',
      ariaLabel: name === 'map' ? 'Térkép' : 'Adatok',
      onClick: () => show(index),
    })
  );
  replace(dots, buttons);

  function show(next) {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
    if (clamped === page) return;
    page = clamped;
    buttons.forEach((button, i) => button.classList.toggle('is-current', i === page));
    onChange?.(PAGES[page]);
  }

  function onDown(event) {
    // Ignore a second finger: a pinch is not a page turn.
    if (!event.isPrimary) {
      start = null;
      return;
    }
    start = { x: event.clientX, y: event.clientY };

    // Capture, so a drag that wanders off this panel still reports its
    // pointerup here. Without it a swipe that drifts far enough vertically
    // to leave the strip is simply never completed — and the navigation
    // panel is only about two hundred pixels tall, so that drift is a
    // sixty-pixel horizontal swipe away. Released implicitly on pointerup.
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onUp(event) {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;

    // Too short is a tap; too steep is someone trying to scroll.
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return;

    show(page + (dx < 0 ? 1 : -1));
  }

  for (const surface of surfaces) {
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', () => { start = null; });
  }

  buttons[0].classList.add('is-current');

  return {
    get page() {
      return PAGES[page];
    },
  };
}
