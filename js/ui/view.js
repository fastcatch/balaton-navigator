/**
 * Full-screen view stack.
 *
 * Spec section 7 asks for full-screen list views rather than nested modals.
 * Exactly one view is open at a time; opening another replaces it. There is
 * no stack to get lost in, and "back" always means "back to the map".
 */

import { replace } from './dom.js';

export function createViewHost({ root, titleEl, bodyEl, backButton, onClose }) {
  let current = null;

  function close() {
    if (!current) return;
    current = null;
    root.classList.add('is-hidden');
    replace(bodyEl, []);
    onClose?.();
  }

  backButton.addEventListener('click', close);

  return {
    get isOpen() {
      return current !== null;
    },

    get current() {
      return current;
    },

    /** Show `content` full-screen under `title`, replacing any open view. */
    open(name, title, content) {
      current = name;
      titleEl.textContent = title;
      replace(bodyEl, content);
      bodyEl.scrollTop = 0;
      root.classList.remove('is-hidden');
    },

    /** Re-render the open view's body in place, keeping scroll position. */
    update(name, content) {
      if (current !== name) return;
      const scroll = bodyEl.scrollTop;
      replace(bodyEl, content);
      bodyEl.scrollTop = scroll;
    },

    close,
  };
}
