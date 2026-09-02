"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { computeToastStyle, findActionAnchor } from "@/lib/action-toast";

export type ActionToastState = {
  message: string;
  style: CSSProperties;
} | null;

export function useActionToast(durationMs = 2800) {
  const lastAnchorRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<ActionToastState>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      lastAnchorRef.current = findActionAnchor(event.target);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, durationMs]);

  useEffect(() => {
    if (!toast) return;

    function reposition() {
      setToast((current) =>
        current ? { ...current, style: computeToastStyle(lastAnchorRef.current) } : null,
      );
    }

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [toast?.message]);

  const showToast = useCallback((message: string, anchor?: HTMLElement | null) => {
    const el = anchor ?? lastAnchorRef.current;
    setToast({ message, style: computeToastStyle(el) });
  }, []);

  const toastNode = (
    <div className={toast ? "toast on" : "toast"} style={toast?.style}>
      {toast?.message}
    </div>
  );

  return { showToast, toastNode };
}
