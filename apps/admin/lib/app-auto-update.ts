"use client";

import { useEffect } from "react";
import { APP_BUILD } from "@/lib/app-build";
import { bustClientCaches } from "@/lib/bust-client-cache";
import { flushAllMirrorQueues } from "@/lib/supabase/mirror-queue";

/**
 * Versión nueva publicada → el aparato la toma solo, sin que nadie recargue.
 * Antes solo se revisaba al abrir la app: un celular abierto todo el día seguía con el
 * código viejo (sin los arreglos del taller y con colas que el servidor nuevo rechaza).
 *
 * Nunca interrumpe un cobro: no recarga con panel / diálogo / campo abierto.
 * Obligatoria: recarga al volver a la app, con 2 min sin tocar, o a los 5 min de
 * publicada en el primer momento libre. La subida previa tiene tope: lo que no subió
 * sigue en la cola del aparato y lo sube la versión nueva (antes una petición colgada
 * dejaba el celular en la versión vieja para siempre).
 */
const CHECK_MS = 60_000;
const IDLE_MS = 120_000;
const FORCE_AFTER_MS = 5 * 60_000;
const FLUSH_CAP_MS = 15_000;
const BUILD_CHECK_TIMEOUT_MS = 10_000;
const TARGET_KEY = "nexo-auto-update-target";

function screenBusy() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    return true;
  }
  return Boolean(document.querySelector('.is-open, [role="dialog"], [aria-modal="true"]'));
}

async function servedBuild(): Promise<string> {
  try {
    const res = await fetch("/api/ops/build-health", {
      cache: "no-store",
      signal: AbortSignal.timeout(BUILD_CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { build?: string };
    return String(data.build || "").trim();
  } catch (error) {
    console.error("auto-update-check", error);
    return "";
  }
}

async function flushWithCap(): Promise<void> {
  try {
    await Promise.race([
      flushAllMirrorQueues({ attempts: 1 }),
      new Promise<void>((resolve) => window.setTimeout(resolve, FLUSH_CAP_MS)),
    ]);
  } catch (error) {
    console.error("auto-update-flush", error);
  }
}

export function useAppAutoUpdate(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && (!APP_BUILD || APP_BUILD === "dev")) return;

    /**
     * Taller (dev): Fast Refresh puede dejar módulos viejos vivos en una pestaña abierta
     * (mitad código nuevo, mitad viejo: colas que no suben, saldos de otra versión).
     * La pestaña ancla el commit que encontró al abrir; si HEAD cambia, recarga completa.
     */
    let running = isProd ? APP_BUILD : "";
    let lastTouch = Date.now();
    let target = "";
    let targetSince = 0;
    let applying = false;
    const touch = () => {
      lastTouch = Date.now();
    };

    async function tick(resumed = false) {
      if (applying) return;
      if (!target) {
        const build = await servedBuild();
        if (!build) return;
        if (!running) {
          running = build;
          return;
        }
        if (build === running) return;
        // Ya se recargó hacia esa versión y el CDN aún sirve la vieja: no entrar en bucle.
        if (window.sessionStorage.getItem(TARGET_KEY) === build) return;
        target = build;
        targetSince = Date.now();
      }
      if (screenBusy()) return;
      const idle = Date.now() - lastTouch >= IDLE_MS;
      const overdue = Date.now() - targetSince >= FORCE_AFTER_MS;
      if (!resumed && !idle && !overdue) return;
      applying = true;
      await flushWithCap();
      try {
        window.sessionStorage.setItem(TARGET_KEY, target);
        await bustClientCaches();
      } catch (error) {
        console.error("auto-update-apply", error);
      }
      window.location.reload();
    }

    const events = ["pointerdown", "keydown", "touchstart", "input"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void tick(), CHECK_MS);
    void tick(true);
    return () => {
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [enabled]);
}
