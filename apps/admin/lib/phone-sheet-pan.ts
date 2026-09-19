/**
 * Celular: una sola hoja con pan en un eje (tipo planilla).
 * Lado → scrollLeft de la hoja. Abajo → scrollTop de la misma hoja.
 * No deja que el workspace/página robe el gesto.
 */

const SHEET_SEL =
  ".table-wrap, .bank-table-wrap, .route-clients-table-wrap, .panel-surface, .sheet";

const LOCK_PX = 6;
const X_BIAS = 1.05;

type Axis = "x" | "y";

type PanState = {
  wrap: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  axis: Axis | null;
  canX: boolean;
  canY: boolean;
};

function closestSheet(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const wrap = target.closest(SHEET_SEL);
  return wrap instanceof HTMLElement ? wrap : null;
}

export function bindPhoneSheetPan(root: HTMLElement): () => void {
  let state: PanState | null = null;

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      state = null;
      return;
    }
    const wrap = closestSheet(e.target);
    if (!wrap) {
      state = null;
      return;
    }
    const canX = wrap.scrollWidth > wrap.clientWidth + 2;
    const canY = wrap.scrollHeight > wrap.clientHeight + 2;
    if (!canX && !canY) {
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
      canX,
      canY,
    };
    wrap.classList.add("is-sheet-panning");
  }

  function onMove(e: TouchEvent) {
    if (!state || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.axis) {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      const preferX = Math.abs(dx) > Math.abs(dy) * X_BIAS;
      if (preferX && state.canX) state.axis = "x";
      else if (!preferX && state.canY) state.axis = "y";
      else if (state.canX && Math.abs(dx) >= Math.abs(dy)) state.axis = "x";
      else if (state.canY) state.axis = "y";
      else if (state.canX) state.axis = "x";
      else return;
    }

    e.preventDefault();

    if (state.axis === "x") {
      state.wrap.scrollLeft -= t.clientX - state.lastX;
    } else {
      state.wrap.scrollTop -= t.clientY - state.lastY;
    }

    state.lastX = t.clientX;
    state.lastY = t.clientY;
  }

  function onEnd() {
    if (state?.wrap) state.wrap.classList.remove("is-sheet-panning");
    state = null;
  }

  root.addEventListener("touchstart", onStart, { passive: true, capture: true });
  root.addEventListener("touchmove", onMove, { passive: false, capture: true });
  root.addEventListener("touchend", onEnd, { passive: true, capture: true });
  root.addEventListener("touchcancel", onEnd, { passive: true, capture: true });

  return () => {
    if (state?.wrap) state.wrap.classList.remove("is-sheet-panning");
    root.removeEventListener("touchstart", onStart, true);
    root.removeEventListener("touchmove", onMove, true);
    root.removeEventListener("touchend", onEnd, true);
    root.removeEventListener("touchcancel", onEnd, true);
  };
}
