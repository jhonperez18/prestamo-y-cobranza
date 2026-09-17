/**
 * Tras abrir/cerrar un panel en móvil, el navegador a veces dispara un click
 * sintético sobre lo que quedó debajo (p. ej. INICIO). Bloquea ese eco —
 * sin comerse el siguiente toque intencional en la barra de navegación
 * ni gestos dentro del lightbox de comprobantes.
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
      ].join(", "),
    ),
  );
}

export function clearNavQuiet(): void {
  quietUntil = 0;
}

export function suppressGhostClick(ms = 420): void {
  const until = Date.now() + ms;
  if (until > quietUntil) quietUntil = until;

  if (typeof document === "undefined") return;

  const block = (event: Event) => {
    if (Date.now() >= quietUntil) return;
    // Menú KPI / lightbox de comprobante: nunca bloquear.
    if (isExemptTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const opts: AddEventListenerOptions = { capture: true };

  // Armar en el siguiente tick para no comerse el gesto intencional en curso.
  window.setTimeout(() => {
    if (Date.now() >= quietUntil) return;
    document.addEventListener("click", block, opts);
    document.addEventListener("pointerup", block, opts);
    document.addEventListener("touchend", block, opts);
    const left = Math.max(0, quietUntil - Date.now());
    window.setTimeout(() => {
      document.removeEventListener("click", block, opts);
      document.removeEventListener("pointerup", block, opts);
      document.removeEventListener("touchend", block, opts);
    }, left);
  }, 0);
}

/** true = no navegar (KPI / INICIO) por un eco de toque reciente. */
export function isNavQuiet(): boolean {
  return Date.now() < quietUntil;
}
