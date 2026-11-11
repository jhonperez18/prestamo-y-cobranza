"use client";

import { useEffect, useState } from "react";
import {
  ENLACE_OFICINA_CHANGED_EVENT,
  readEnlaceOficinaSnapshot,
  startEnlaceOficinaWatch,
} from "./reach";
import type { EnlaceOficinaSnapshot } from "./types";

/**
 * Franja del cobrador: estado vivo del enlace con la oficina.
 * No bloquea UI de cobro.
 */
export function useEnlaceOficina(): EnlaceOficinaSnapshot {
  const [snap, setSnap] = useState<EnlaceOficinaSnapshot>(() =>
    typeof window === "undefined"
      ? {
          estado: "ok",
          label: "Enlace · al día",
          pending: 0,
          lastReachAt: null,
          lastReachOk: null,
          online: true,
        }
      : readEnlaceOficinaSnapshot(),
  );

  useEffect(() => {
    startEnlaceOficinaWatch();
    setSnap(readEnlaceOficinaSnapshot());
    function onChange(event: Event) {
      const detail = (event as CustomEvent<EnlaceOficinaSnapshot>).detail;
      if (detail && detail.estado) {
        setSnap(detail);
        return;
      }
      setSnap(readEnlaceOficinaSnapshot());
    }
    window.addEventListener(ENLACE_OFICINA_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(ENLACE_OFICINA_CHANGED_EVENT, onChange);
    };
  }, []);

  return snap;
}
