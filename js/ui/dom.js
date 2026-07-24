/**
 * Minimal DOM helpers.
 *
 * Everything here sets text through `textContent`, never `innerHTML`, so a
 * route or track name containing markup is displayed rather than parsed.
 */

/**
 * Build an element.
 *
 * `props` maps to properties (className, textContent, type, ...) except for
 * keys starting with `on`, which are attached as listeners, and `dataset`.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else {
      node[key] = value;
    }
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child);
  }

  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function replace(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

/** An icon-sized button, e.g. delete or reorder. */
export const iconButton = (label, onClick, extraClass = '') =>
  el('button', {
    type: 'button',
    className: `icon-btn ${extraClass}`.trim(),
    textContent: label,
    ariaLabel: label,
    onClick,
  });

export const empty = (message) => el('p', { className: 'empty', textContent: message });
