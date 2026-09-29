"use client";

import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.4;

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };

type Props = {
  src: string;
  sizeLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function withScale(view: View, scale: number): View {
  const next = clampScale(scale);
  if (next === MIN_SCALE) return { scale: MIN_SCALE, x: 0, y: 0 };
  const ratio = next / view.scale;
  return { scale: next, x: view.x * ratio, y: view.y * ratio };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Aislar el visor: ningún toque llega a la tarjeta de cobro (el panel Pagar sigue abierto). */
function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Vista previa del comprobante elegido de la galería: acercar / alejar (pellizco,
 * rueda, doble toque o botones) antes de confirmar. Cancelar no toca el comprobante.
 */
export function ReceiptZoomPreview({ src, sizeLabel, onConfirm, onCancel }: Props) {
  const [view, setView] = useState<View>({ scale: MIN_SCALE, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ start: Point; x: number; y: number } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function beginGesture() {
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      pan.current = null;
      pinch.current = { dist: distance(points[0]!, points[1]!), scale: view.scale };
    } else if (points.length === 1) {
      pinch.current = null;
      pan.current = { start: points[0]!, x: view.x, y: view.y };
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length >= 2 && pinch.current) {
      const { dist, scale } = pinch.current;
      const ratio = distance(points[0]!, points[1]!) / (dist || 1);
      setView((current) => withScale(current, scale * ratio));
      return;
    }
    if (points.length === 1 && pan.current && view.scale > MIN_SCALE) {
      const { start, x, y } = pan.current;
      setView((current) => ({ ...current, x: x + points[0]!.x - start.x, y: y + points[0]!.y - start.y }));
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    beginGesture();
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.stopPropagation();
    setView((current) => withScale(current, current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
  }

  function zoomBy(factor: number) {
    setView((current) => withScale(current, current.scale * factor));
  }

  function toggleZoom() {
    setView((current) => (current.scale > MIN_SCALE ? withScale(current, MIN_SCALE) : withScale(current, 2.5)));
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="receipt-zoom"
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa del comprobante"
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
    >
      <div className="receipt-zoom-head">
        <b>Vista previa</b>
        <span>{sizeLabel ? `${sizeLabel} · ` : ""}Pellizque o use + / − para acercar</span>
      </div>

      <div
        className="receipt-zoom-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={onWheel}
        onDoubleClick={toggleZoom}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Comprobante elegido"
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>

      <div className="receipt-zoom-tools">
        <button type="button" onClick={() => zoomBy(1 / STEP)} disabled={view.scale <= MIN_SCALE} aria-label="Alejar">
          −
        </button>
        <button type="button" className="is-level" onClick={() => setView({ scale: MIN_SCALE, x: 0, y: 0 })}>
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" onClick={() => zoomBy(STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Acercar">
          +
        </button>
      </div>

      <div className="receipt-zoom-actions">
        <button type="button" className="is-cancel" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="is-confirm" onClick={onConfirm}>
          Confirmar
        </button>
      </div>
    </div>,
    document.body,
  );
}
