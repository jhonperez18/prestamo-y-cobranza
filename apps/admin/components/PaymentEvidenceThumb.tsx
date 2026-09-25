"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildReceiptEvidence,
  compressReceiptImage,
  formatEvidenceSize,
  primaryPaymentEvidence,
  resolvePaymentEvidencePreview,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";
import { suppressGhostClick } from "@/lib/suppress-ghost-click";

type Props = {
  evidence?: PaymentEvidenceRef[];
  /** Tamaño de la miniatura en px (solo variant thumb). */
  size?: number;
  emptyLabel?: string;
  /** thumb = celda de tabla; panel = ficha con imagen grande */
  variant?: "thumb" | "panel";
  /** Si no hay foto, permite subir el comprobante (Nequi sin evidencia en nube). */
  onAttach?: (evidence: PaymentEvidenceRef) => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

type ViewState = { scale: number; x: number; y: number };

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function EvidenceLightbox({
  openUrl,
  sizeHint,
  isDemoPreview,
  title,
  onClose,
}: {
  openUrl: string;
  sizeHint: string;
  isDemoPreview: boolean;
  title: string;
  onClose: () => void;
}) {
  const canOpenExternal = /^https?:\/\//i.test(openUrl);
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);
  const didDrag = useRef(false);

  function commitView(next: ViewState) {
    viewRef.current = next;
    setView(next);
  }

  function resetView() {
    commitView({ scale: 1, x: 0, y: 0 });
  }

  useEffect(() => {
    resetView();
    pointers.current.clear();
    pinchStart.current = null;
    panStart.current = null;
    // Solo al abrir otra imagen.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset por openUrl
  }, [openUrl]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const scale = clampZoom(viewRef.current.scale + ZOOM_STEP);
        commitView({ ...viewRef.current, scale });
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        const scale = clampZoom(viewRef.current.scale - ZOOM_STEP);
        commitView(scale <= 1 ? { scale: 1, x: 0, y: 0 } : { ...viewRef.current, scale });
      }
      if (event.key === "0") {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function zoomBy(delta: number) {
    const scale = clampZoom(viewRef.current.scale + delta);
    commitView(scale <= 1 ? { scale: 1, x: 0, y: 0 } : { ...viewRef.current, scale });
  }

  function beginPanFromPointer(pointerId: number) {
    const point = pointers.current.get(pointerId);
    if (!point || viewRef.current.scale <= 1) {
      panStart.current = null;
      return;
    }
    panStart.current = {
      x: point.x,
      y: point.y,
      ox: viewRef.current.x,
      oy: viewRef.current.y,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    didDrag.current = false;

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStart.current = { dist: Math.max(dist, 1), scale: viewRef.current.scale };
      panStart.current = null;
      return;
    }

    beginPanFromPointer(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchStart.current;
    if (pointers.current.size >= 2 && pinch) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const nextScale = clampZoom(pinch.scale * (dist / pinch.dist));
      didDrag.current = true;
      if (nextScale <= 1) {
        commitView({ scale: 1, x: 0, y: 0 });
      } else {
        commitView({ ...viewRef.current, scale: nextScale });
      }
      return;
    }

    const pan = panStart.current;
    if (pointers.current.size === 1 && pan && viewRef.current.scale > 1) {
      // Snapshot local: nunca leer panStart dentro de un updater de React.
      const x = pan.ox + (event.clientX - pan.x);
      const y = pan.oy + (event.clientY - pan.y);
      if (Math.abs(event.clientX - pan.x) > 2 || Math.abs(event.clientY - pan.y) > 2) {
        didDrag.current = true;
      }
      commitView({ scale: viewRef.current.scale, x, y });
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (stage?.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    pointers.current.delete(event.pointerId);

    if (pointers.current.size < 2) {
      pinchStart.current = null;
    }

    if (pointers.current.size === 1) {
      const remainingId = pointers.current.keys().next().value as number | undefined;
      if (remainingId != null) beginPanFromPointer(remainingId);
      else panStart.current = null;
      return;
    }

    panStart.current = null;
  }

  function onDoubleActivate(event: React.MouseEvent | React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (viewRef.current.scale > 1.05) resetView();
    else commitView({ scale: 2.2, x: 0, y: 0 });
  }

  function onStageClick(event: React.MouseEvent<HTMLDivElement>) {
    if (didDrag.current) {
      didDrag.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      onDoubleActivate(event);
      return;
    }
    lastTap.current = now;
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? ZOOM_STEP * 0.4 : -ZOOM_STEP * 0.4;
    zoomBy(delta);
  }

  const node = (
    <div
      className="evidence-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onTouchMove={(event) => event.stopPropagation()}
    >
      <div
        className="evidence-lightbox-panel"
        onClick={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{title}</strong>
          {sizeHint !== "—" ? <span className="evidence-lightbox-meta">{sizeHint}</span> : null}
          {isDemoPreview ? <span className="evidence-demo-tag">Demo</span> : null}
          <div className="evidence-lightbox-zoom" role="group" aria-label="Ampliar comprobante">
            <button
              type="button"
              className="evidence-lightbox-zoom-btn"
              aria-label="Alejar"
              disabled={view.scale <= MIN_ZOOM}
              onClick={(event) => {
                event.stopPropagation();
                zoomBy(-ZOOM_STEP);
              }}
            >
              −
            </button>
            <button
              type="button"
              className="evidence-lightbox-zoom-btn"
              aria-label="Acercar"
              disabled={view.scale >= MAX_ZOOM}
              onClick={(event) => {
                event.stopPropagation();
                zoomBy(ZOOM_STEP);
              }}
            >
              +
            </button>
          </div>
          {canOpenExternal ? (
            <a
              className="btn ghost compact"
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Abrir
            </a>
          ) : null}
          <button
            type="button"
            className="evidence-lightbox-close"
            aria-label="Cerrar ampliación"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        </header>
        <div
          ref={stageRef}
          className={`evidence-lightbox-stage${view.scale > 1 ? " is-zoomed" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onStageClick}
          onDoubleClick={onDoubleActivate}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={openUrl}
            alt={`${title} ampliado`}
            draggable={false}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        </div>
        <p className="evidence-lightbox-hint">
          Empieza completa y pequeña · + / − o pellizcá para tamaño · doble toque para zoom
        </p>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

export function PaymentEvidenceThumb({
  evidence,
  size = 22,
  emptyLabel = "—",
  variant = "thumb",
  onAttach,
}: Props) {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const item = primaryPaymentEvidence(evidence) ?? evidence?.[0] ?? null;
  const directPreview = item ? resolvePaymentEvidencePreview(item) : null;
  const previewUrl = resolvedUrl || directPreview;
  const isSignature = item?.kind === "firma";
  const label = isSignature ? "Firma del cliente" : "Comprobante de pago";

  const close = useCallback(() => {
    suppressGhostClick();
    setOpenUrl(null);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancel = false;
    const direct = item ? resolvePaymentEvidencePreview(item) : null;
    if (direct) {
      setResolvedUrl(direct);
      return () => {
        cancel = true;
      };
    }

    const path = item?.fileId?.trim() || "";
    if (!path || path.startsWith("data:") || !path.includes("/")) {
      setResolvedUrl(null);
      return () => {
        cancel = true;
      };
    }

    setResolvedUrl(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/payments/evidence-url?path=${encodeURIComponent(path)}`,
          { method: "GET", cache: "no-store" },
        );
        const body = (await res.json()) as { ok?: boolean; url?: string };
        if (!cancel && body.ok && body.url) setResolvedUrl(body.url);
      } catch {
        if (!cancel) setResolvedUrl(null);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [item?.id, item?.fileId, item?.previewUrl]);

  async function onPhoto(file: File | undefined) {
    if (!file || !onAttach) return;
    setBusy(true);
    try {
      const compressed = await compressReceiptImage(file);
      onAttach(buildReceiptEvidence(compressed.dataUrl, compressed));
    } catch {
      // Silencioso: el padre puede mostrar toast; no tumbar la lista.
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openPreview(event: React.MouseEvent | React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!previewUrl) return;
    setOpenUrl(previewUrl);
  }

  if (!item || !previewUrl) {
    if (onAttach) {
      return (
        <span className="payment-evidence-attach">
          <input
            id={inputId}
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void onPhoto(event.target.files?.[0])}
          />
          <button
            type="button"
            className="payment-evidence-attach-btn"
            title="Subir comprobante"
            aria-label="Subir comprobante"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              fileRef.current?.click();
            }}
            style={{ width: Math.max(size, 28), height: Math.max(size, 28) }}
          >
            {busy ? "…" : "+"}
          </button>
        </span>
      );
    }
    return <span className="payment-evidence-empty">{emptyLabel}</span>;
  }

  const sizeHint = formatEvidenceSize(item.byteSize);
  const isDemoPreview = !item.previewUrl?.trim();
  const title = `Ver ${isSignature ? "firma" : "comprobante"} ampliado${sizeHint !== "—" ? ` · ${sizeHint}` : ""}`;

  const lightbox =
    mounted && openUrl ? (
      <EvidenceLightbox
        openUrl={openUrl}
        sizeHint={sizeHint}
        isDemoPreview={isDemoPreview}
        title={label}
        onClose={close}
      />
    ) : null;

  if (variant === "panel") {
    return (
      <>
        <div className="payment-evidence-panel">
          <button
            type="button"
            className={
              isSignature
                ? "payment-evidence-panel-btn is-signature"
                : "payment-evidence-panel-btn"
            }
            title={title}
            aria-label={`Ampliar ${isSignature ? "firma" : "comprobante"}`}
            onClick={openPreview}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt={label} />
          </button>
          <p className="payment-evidence-panel-hint">Toca la imagen para ampliarla</p>
        </div>
        {lightbox}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={isSignature ? "payment-evidence-thumb is-signature" : "payment-evidence-thumb"}
        title={title}
        aria-label={`Ver ${isSignature ? "firma" : "comprobante"} ampliado`}
        onClick={openPreview}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt={label} />
      </button>
      {lightbox}
    </>
  );
}
