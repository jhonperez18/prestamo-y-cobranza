/**
 * Click fantasma en móvil: el touch fue en A, A se desmonta/mueve, y el
 * `click` sintético cae en B (p. ej. INICIO). Solo aceptamos navegación si
 * el mismo elemento recibió pointerdown y luego click.
 *
 * No limpiar anti-eco durante la ventana quiet: un pointerdown fantasma
 * sobre KPI/menú no debe anular la protección ni armar un click falso.
 */
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import { clearNavQuiet, isNavQuiet } from "@/lib/suppress-ghost-click";

type NavIntentHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  guard: (event: SyntheticEvent<HTMLElement>) => boolean;
};

export function createNavIntent(): NavIntentHandlers {
  let armed: EventTarget | null = null;

  return {
    onPointerDown(event) {
      if (!event.isPrimary) return;
      // Eco tras abrir cobro: no armar ni borrar quiet (si no, el panel se cierra).
      if (isNavQuiet()) return;
      // Nuevo gesto real en menú = intención; no heredar quiet viejo.
      clearNavQuiet();
      armed = event.currentTarget;
    },
    guard(event) {
      const ok = armed === event.currentTarget;
      armed = null;
      return ok;
    },
  };
}

/** Atajo: props para un botón de navegación. */
export function navButtonProps(intent: NavIntentHandlers, action: () => void) {
  return {
    "data-nav-btn": "1",
    onPointerDown: intent.onPointerDown,
    onClick: (event: SyntheticEvent<HTMLElement>) => {
      if (!intent.guard(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      action();
    },
  };
}
