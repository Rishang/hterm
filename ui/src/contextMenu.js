// Shared placement for the app's context menus (file explorer, terminal).

/**
 * Where to show a menu opened at the cursor `(x, y)`: where its measured size
 * would overflow the window, flip it to the other side of the cursor like a
 * native menu, so it stays anchored to what was clicked instead of drifting.
 * @param {number} x @param {number} y @param {HTMLElement} el the rendered menu
 */
export function placeContextMenu(x, y, el) {
  const { width, height } = el.getBoundingClientRect();
  /** @param {number} at @param {number} size @param {number} limit */
  const place = (at, size, limit) => Math.max(4, at + size + 4 > limit ? at - size : at);
  return { x: place(x, width, window.innerWidth), y: place(y, height, window.innerHeight) };
}
