"use client";

import { useEffect, useState } from "react";
import { sameRoute } from "@/lib/client-route-order";

/** Misma regla que AuthGate / AppShell: ≤900px = layout celular. */
export function usePhoneLayout(maxWidthPx = 900) {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [maxWidthPx]);
  return phone;
}

/** Pin activo de ruta; si la lista cambia, encaja al primero válido. */
export function useRouteBoardPin(routeNames: string[]) {
  const [active, setActive] = useState(() => routeNames[0] ?? "");
  useEffect(() => {
    if (!routeNames.length) {
      setActive("");
      return;
    }
    if (!routeNames.some((name) => sameRoute(name, active))) {
      setActive(routeNames[0]!);
    }
  }, [routeNames, active]);
  return [active, setActive] as const;
}

export function RouteBoardPins({
  routes,
  active,
  onPick,
  countOf,
}: {
  routes: string[];
  active: string;
  onPick: (name: string) => void;
  countOf?: (name: string) => number;
}) {
  if (!routes.length) return null;
  const pinCount = Math.min(Math.max(routes.length, 1), 5);
  return (
    <div
      className={`client-route-pins is-pins-${pinCount}`}
      role="tablist"
      aria-label="Elegir ruta"
    >
      {routes.map((name) => {
        const on = sameRoute(active, name);
        const count = countOf?.(name);
        const label = name === "Sin ruta" ? "—" : name;
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={on}
            title={name === "Sin ruta" ? "Sin ruta" : `Ruta ${name}`}
            className={on ? "client-route-tab on" : "client-route-tab"}
            onClick={() => onPick(name)}
          >
            {label}
            {typeof count === "number" ? (
              <span className="client-route-tab-count">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
