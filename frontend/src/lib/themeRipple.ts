/**
 * Water-ripple theme transition (UI v2, Agent B).
 *
 * On toggle, a circle of the OLD theme's background colour starts at the
 * toggle button and shrinks back into it while the new theme is already
 * live underneath — so the new theme visibly spreads from the button
 * across the whole page, like a drop spreading in water. The circle is
 * sized to the farthest screen corner, so the bottom-left corner (the
 * toggle sits top-right) is covered last. Works the same in both
 * directions: the overlay always carries the theme being left.
 *
 * The overlay is pointer-events: none and is removed after the animation,
 * so it can never block clicks. Under prefers-reduced-motion the theme
 * flips instantly with no animation.
 */
const RIPPLE_MS = 750;

export function playThemeRipple(
  originX: number,
  originY: number,
  applyTheme: () => void,
): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme();
    return;
  }

  // A fast double-click starts a fresh ripple instead of stacking two.
  document
    .querySelectorAll('.theme-ripple-overlay')
    .forEach((el) => el.remove());

  // Read the old theme's background before flipping.
  const oldBg =
    getComputedStyle(document.body).backgroundColor || '#ffffff';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const radius =
    Math.ceil(
      Math.hypot(
        Math.max(originX, vw - originX),
        Math.max(originY, vh - originY),
      ),
    ) + 40;

  const overlay = document.createElement('div');
  overlay.className = 'theme-ripple-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.background = oldBg;
  overlay.style.clipPath = `circle(${radius}px at ${originX}px ${originY}px)`;
  document.body.appendChild(overlay);

  // Flip the theme on the next frame, then shrink the old-theme circle
  // back into the button — the new theme spreads outward from it.
  requestAnimationFrame(() => {
    applyTheme();
    overlay.style.clipPath = `circle(0px at ${originX}px ${originY}px)`;
  });

  window.setTimeout(() => overlay.remove(), RIPPLE_MS + 150);
}
