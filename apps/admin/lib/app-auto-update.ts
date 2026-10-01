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
 * Nunca interrumpe un cobro: recarga solo con 2 min sin tocar la pantalla, sin panel /
 * diálogo / campo abierto, y después de subir a la nube lo pendiente.
 */
const CHECK_MS = 60_000;
const IDLE_MS = 120_000;
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
    const res = await fetch("/api/ops/build-health", { cache: "no-store" });
    if (!res.ok) return "";
    const data = (await res.json()) as { build?: string };
    return String(data.build || "").trim();
  } catch (error) {
    console.error("auto-update-check", error);
    return "";
  }
}

export function useAppAutoUpdate(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production" || !APP_BUILD || APP_BUILD === "dev") return;

    let lastTouch = Date.now();
    let target = "";
    let applying = false;
    const touch = () => {
      lastTouch = Date.now();
    };

    async function tick() {
      if (applying) return;
      if (!target) {
        const build = await servedBuild();
        if (!build || build === APP_BUILD) return;
        // Ya se recargó hacia esa versión y el CDN aún sirve la vieja: no entrar en bucle.
        if (window.sessionStorage.getItem(TARGET_KEY) === build) return;
        target = build;
      }
      if (Date.now() - lastTouch < IDLE_MS || screenBusy()) return;
      applying = true;
      try {
        await flushAllMirrorQueues();
        window.sessionStorage.setItem(TARGET_KEY, target);
        await bustClientCaches();
        window.location.reload();
      } catch (error) {
        console.error("auto-update-apply", error);
        applying = false;
      }
    }

    const events = ["pointerdown", "keydown", "touchstart", "input"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void tick(), CHECK_MS);
    return () => {
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [enabled]);
}
