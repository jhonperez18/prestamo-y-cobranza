"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { computeToastStyle, findActionAnchor } from "@/lib/action-toast";

export type ActionToastState = {
  message: string;
  style: CSSProperties;
} | null;

/** Sigue al botón al hacer scroll sin redibujar la pantalla que lo muestra. */
const ActionToast = memo(function ActionToast({
  toast,
  anchorRef,
}: {
  toast: ActionToastState;
  anchorRef: MutableRefObject<HTMLElement | null>;
}) {
  const [moved, setMoved] = useState<{ toast: ActionToastState; style: CSSProperties } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) return;
    const reposition = () => setMoved({ toast, style: computeToastStyle(anchorRef.current) });
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [toast, anchorRef]);

  const style = toast && moved?.toast === toast ? moved.style : toast?.style;
  return (
    <div className={toast ? "toast on" : "toast"} style={style}>
      {toast?.message}
    </div>
  );
});

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

  const showToast = useCallback((message: string, anchor?: HTMLElement | null) => {
    const el = anchor ?? lastAnchorRef.current;
    setToast({ message, style: computeToastStyle(el) });
  }, []);

  const toastNode = <ActionToast toast={toast} anchorRef={lastAnchorRef} />;

  return { showToast, toastNode };
}
