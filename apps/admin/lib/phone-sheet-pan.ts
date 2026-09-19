/**
 * En celular: bloquea el eje del gesto en hojas anchas (tablas).
 * Lado → solo scroll horizontal de la hoja (no arrastra la página).
 * Arriba/abajo → scroll vertical de la página / contenedor.
 */

const SHEET_SEL =
  ".table-wrap, .bank-table-wrap, .route-clients-table-wrap, .panel-surface, .sheet";

const LOCK_PX = 8;
const X_BIAS = 1.15;

type Axis = "x" | "y";

type PanState = {
  wrap: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  axis: Axis | null;
  scroller: HTMLElement | null;
};

function closestSheet(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const wrap = target.closest(SHEET_SEL);
  return wrap instanceof HTMLElement ? wrap : null;
}

function verticalScroller(from: HTMLElement): HTMLElement {
  let node: HTMLElement | null = from.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      node.scrollHeight > node.clientHeight + 2
    ) {
      return node;
    }
    node = node.parentElement;
  }
  const doc = document.scrollingElement;
  return doc instanceof HTMLElement ? doc : document.documentElement;
}

export function bindPhoneSheetPan(root: HTMLElement): () => void {
  let state: PanState | null = null;

  function clearLockClass() {
    document.documentElement.classList.remove("phone-sheet-pan-x");
  }

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      state = null;
      clearLockClass();
      return;
    }
    const wrap = closestSheet(e.target);
    if (!wrap || wrap.scrollWidth <= wrap.clientWidth + 2) {
      state = null;
      return;
    }
    const t = e.touches[0];
    state = {
      wrap,
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      axis: null,
      scroller: null,
    };
    wrap.style.touchAction = "none";
  }

  function onMove(e: TouchEvent) {
    if (!state || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.axis) {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      state.axis = Math.abs(dx) > Math.abs(dy) * X_BIAS ? "x" : "y";
      if (state.axis === "x") {
        document.documentElement.classList.add("phone-sheet-pan-x");
      } else {
        state.scroller = verticalScroller(state.wrap);
      }
    }

    e.preventDefault();

    if (state.axis === "x") {
      state.wrap.scrollLeft -= t.clientX - state.lastX;
    } else if (state.scroller) {
      state.scroller.scrollTop -= t.clientY - state.lastY;
    }

    state.lastX = t.clientX;
    state.lastY = t.clientY;
  }

  function onEnd() {
    if (state?.wrap) state.wrap.style.touchAction = "";
    state = null;
    clearLockClass();
  }

  root.addEventListener("touchstart", onStart, { passive: true, capture: true });
  root.addEventListener("touchmove", onMove, { passive: false, capture: true });
  root.addEventListener("touchend", onEnd, { passive: true, capture: true });
  root.addEventListener("touchcancel", onEnd, { passive: true, capture: true });

  return () => {
    if (state?.wrap) state.wrap.style.touchAction = "";
    root.removeEventListener("touchstart", onStart, true);
    root.removeEventListener("touchmove", onMove, true);
    root.removeEventListener("touchend", onEnd, true);
    root.removeEventListener("touchcancel", onEnd, true);
    clearLockClass();
  };
}
