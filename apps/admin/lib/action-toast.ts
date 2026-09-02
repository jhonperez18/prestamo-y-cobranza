import type { CSSProperties } from "react";

const TOAST_MAX_WIDTH = 320;
const VIEWPORT_GAP = 8;
const ANCHOR_GAP = 10;

export function findActionAnchor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(
    "button, .btn, .btn-bar, .btn-link, .plus, .go, .grid-tool, input[type='submit']",
  );
  return el instanceof HTMLElement ? el : null;
}

export function computeToastStyle(anchor: HTMLElement | null): CSSProperties {
  const base: CSSProperties = {
    position: "fixed",
    maxWidth: Math.min(TOAST_MAX_WIDTH, window.innerWidth - VIEWPORT_GAP * 2),
    zIndex: 1200,
  };

  if (!anchor) {
    return { ...base, bottom: 18, left: 20 };
  }

  const rect = anchor.getBoundingClientRect();
  const maxWidth = Number(base.maxWidth);
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const fitsRight = rect.right + ANCHOR_GAP + maxWidth <= viewportW - VIEWPORT_GAP;
  const fitsLeft = rect.left - ANCHOR_GAP - maxWidth >= VIEWPORT_GAP;

  if (fitsRight) {
    return {
      ...base,
      top: Math.min(Math.max(rect.top + rect.height / 2, VIEWPORT_GAP), viewportH - VIEWPORT_GAP),
      left: rect.right + ANCHOR_GAP,
      transform: "translateY(-50%)",
    };
  }

  if (fitsLeft) {
    return {
      ...base,
      top: Math.min(Math.max(rect.top + rect.height / 2, VIEWPORT_GAP), viewportH - VIEWPORT_GAP),
      left: rect.left - ANCHOR_GAP - maxWidth,
      transform: "translateY(-50%)",
    };
  }

  return {
    ...base,
    top: Math.min(rect.bottom + ANCHOR_GAP, viewportH - VIEWPORT_GAP),
    left: Math.max(VIEWPORT_GAP, Math.min(rect.left, viewportW - maxWidth - VIEWPORT_GAP)),
  };
}
