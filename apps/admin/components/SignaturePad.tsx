"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSignatureEvidence, type PaymentEvidenceRef } from "@/lib/payment-evidence";

type Props = {
  compact?: boolean;
  required?: boolean;
  value?: PaymentEvidenceRef;
  onChange: (evidence: PaymentEvidenceRef | undefined) => void;
};

/** Trazos cortos (una “V”) deben valer; el muestreo denso evita falsos negativos en pad compacto. */
const MIN_INK_PIXELS = 18;

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function fillWhite(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function inkPixelCount(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  // Cada píxel (RGBA = 4 bytes); antes se saltaba de a 4 y firmas cortas fallaban.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 240 || data[i + 1]! < 240 || data[i + 2]! < 240) ink += 1;
  }
  return ink;
}

function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.round((payload.length * 3) / 4);
}

/** JPEG pequeño para no saturar localStorage con PNG de retina. */
function exportSignatureDataUrl(canvas: HTMLCanvasElement) {
  const maxEdge = 480;
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  if (scale >= 0.98) {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return {
      dataUrl,
      mime: "image/jpeg" as const,
      byteSize: dataUrlBytes(dataUrl),
      width: canvas.width,
      height: canvas.height,
    };
  }
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return {
      dataUrl,
      mime: "image/jpeg" as const,
      byteSize: dataUrlBytes(dataUrl),
      width: canvas.width,
      height: canvas.height,
    };
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  const dataUrl = out.toDataURL("image/jpeg", 0.72);
  return {
    dataUrl,
    mime: "image/jpeg" as const,
    byteSize: dataUrlBytes(dataUrl),
    width,
    height,
  };
}

export function SignaturePad({ compact = false, required, value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const strokeInkRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const valueRef = useRef(value);
  const [signed, setSigned] = useState(Boolean(value?.previewUrl));
  const [hint, setHint] = useState<string | null>(null);
  valueRef.current = value;

  const paintStrokeStyle = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cssWidth = canvas.getBoundingClientRect().width || 1;
    const dpr = canvas.width / cssWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#122018";
    ctx.lineWidth = Math.max(2.2, 2.4 * dpr);
  }, []);

  const restorePreview = useCallback((canvas: HTMLCanvasElement, url: string) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      fillWhite(canvas);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      paintStrokeStyle(canvas);
    };
    img.src = url;
  }, [paintStrokeStyle]);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cssWidth = parent.clientWidth;
    if (cssWidth < 8) return;
    const cssHeight = compact ? 88 : 156;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.max(1, Math.round(cssWidth * dpr));
    const nextH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width === nextW && canvas.height === nextH) return;
    // No redimensionar a mitad de un trazo: borra la firma.
    if (drawingRef.current) return;
    canvas.width = nextW;
    canvas.height = nextH;
    canvas.style.height = `${cssHeight}px`;
    fillWhite(canvas);
    paintStrokeStyle(canvas);
    const preview = valueRef.current?.previewUrl;
    if (preview) restorePreview(canvas, preview);
  }, [compact, paintStrokeStyle, restorePreview]);

  useEffect(() => {
    sizeCanvas();
    const parent = canvasRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sizeCanvas());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [sizeCanvas]);

  useEffect(() => {
    if (value?.previewUrl) {
      setSigned(true);
      setHint(null);
      const canvas = canvasRef.current;
      if (canvas) restorePreview(canvas, value.previewUrl);
      return;
    }
    if (drawingRef.current) return;
    const canvas = canvasRef.current;
    if (canvas) fillWhite(canvas);
    setSigned(false);
  }, [value, restorePreview]);

  function emitSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!strokeInkRef.current || inkPixelCount(canvas) < MIN_INK_PIXELS) {
      // No borrar una firma ya válida por un toque accidental demasiado corto.
      if (valueRef.current?.previewUrl) {
        restorePreview(canvas, valueRef.current.previewUrl);
        setSigned(true);
        setHint(null);
        return;
      }
      setSigned(false);
      setHint("Firme con el dedo en el recuadro (un trazo claro).");
      return;
    }
    const exported = exportSignatureDataUrl(canvas);
    onChange(buildSignatureEvidence(exported.dataUrl, exported));
    setSigned(true);
    setHint(null);
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    strokeInkRef.current = false;
    lastRef.current = canvasPoint(canvas, event.nativeEvent);
    paintStrokeStyle(canvas);
    setHint(null);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastRef.current;
    if (!canvas || !ctx || !last) return;
    event.preventDefault();
    const next = canvasPoint(canvas, event.nativeEvent);
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    if (dx * dx + dy * dy > 0.5) strokeInkRef.current = true;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastRef.current = next;
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastRef.current = null;
    emitSignature();
  }

  function clearPad() {
    const canvas = canvasRef.current;
    if (canvas) {
      fillWhite(canvas);
      paintStrokeStyle(canvas);
    }
    drawingRef.current = false;
    strokeInkRef.current = false;
    lastRef.current = null;
    setSigned(false);
    setHint(null);
    onChange(undefined);
  }

  return (
    <div className={compact ? "signature-pad compact" : "signature-pad"}>
      <div className="signature-pad-head">
        <p className="pay-choice-label">
          Firma del cliente
          {required ? " *" : null}
        </p>
        {signed ? (
          <button type="button" className="btn-link" onClick={clearPad}>
            Borrar
          </button>
        ) : null}
      </div>
      {!compact ? (
        <p className="signature-pad-hint">El cliente firma con el dedo en la pantalla.</p>
      ) : null}
      <div className="signature-pad-frame">
        <canvas
          ref={canvasRef}
          className="signature-pad-canvas"
          aria-label="Pad de firma del cliente"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onContextMenu={(event) => event.preventDefault()}
        />
        {!signed ? <span className="signature-pad-placeholder">Firme aquí</span> : null}
      </div>
      {hint ? (
        <p className="receipt-error" role="alert">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
