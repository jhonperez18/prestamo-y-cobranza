/**
 * Tras abrir/cerrar un panel en móvil, el navegador a veces dispara un click
 * sintético sobre lo que quedó debajo (p. ej. «cerrar» o «Por cobrar»).
 * Bloquea ese eco — sin comerse el gesto en curso (ya estamos en bubble)
 * ni gestos nuevos en la barra de navegación / lightbox / formulario de cobro.
 */

let quietUntil = 0;

function isExemptTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        ".supervisor-mobile-kpi",
        ".collector-mobile-kpi",
        "[data-nav-btn]",
        ".supervisor-mobile-nav-block",
        ".evidence-lightbox",
        ".payment-evidence-thumb",
        ".payment-evidence-panel-btn",
        // Dentro del cobro: método / monto / firma deben responder al toque.
        // «cerrar» se protege aparte con isNavQuiet() en closeCard.
        ".collector-pay-form",
        ".collector-mobile-pay-inline",
        ".signature-pad",
      ].join(", "),
    ),
  );
}

export function clearNavQuiet(): void {
  quietUntil = 0;
}

export function suppressGhostClick(ms = 520): void {
  const until = Date.now() + ms;
  if (until > quietUntil) quietUntil = until;

  if (typeof document === "undefined") return;

  const block = (event: Event) => {
    if (Date.now() >= quietUntil) return;
    if (isExemptTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof (event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === "function") {
      (event as Event & { stopImmediatePropagation: () => void }).stopImmediatePropagation();
    }
  };
  const opts: AddEventListenerOptions = { capture: true };

  // Armar YA (no en el siguiente tick): el eco llega en el mismo gesto tras el
  // reflow del panel. En onClick (bubble) el capture del click actual ya pasó,
  // así que no comemos el toque que abrió el panel.
  // pointerdown también: si no, un eco en KPI llamaba clearNavQuiet y mataba la ventana.
  document.addEventListener("pointerdown", block, opts);
  document.addEventListener("click", block, opts);
  document.addEventListener("pointerup", block, opts);
  document.addEventListener("touchend", block, opts);

  const left = Math.max(0, quietUntil - Date.now());
  window.setTimeout(() => {
    document.removeEventListener("pointerdown", block, opts);
    document.removeEventListener("click", block, opts);
    document.removeEventListener("pointerup", block, opts);
    document.removeEventListener("touchend", block, opts);
  }, left + 16);
}

/** true = no navegar / no cerrar panel por un eco de toque reciente. */
export function isNavQuiet(): boolean {
  return Date.now() < quietUntil;
}
