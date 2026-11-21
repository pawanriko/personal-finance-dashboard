import { useEffect, useRef } from 'react';

/**
 * Cursor glow (UI v2, Agent B): a soft halo that follows the pointer
 * everywhere in the app. Dark theme → soft white glow; light theme → soft
 * dark shadow (the colour comes from the --cursor-glow token, which flips
 * with the theme). Movement is transform-only, driven by
 * requestAnimationFrame-throttled mousemove, so there is no layout work
 * per frame. pointer-events: none, so it can never block clicks, text
 * selection or inputs. Disabled on touch devices (no fine pointer) and
 * under prefers-reduced-motion.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;

    let raf = 0;
    let x = -1000;
    let y = -1000;
    let visible = false;

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        visible = true;
        el.style.opacity = '1';
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      });
    };

    const onLeave = () => {
      visible = false;
      el.style.opacity = '0';
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
