"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSignatureEvidence, type PaymentEvidenceRef } from "@/lib/payment-evidence";

type Props = {
  compact?: boolean;
  required?: boolean;
  value?: PaymentEvidenceRef;
  onChange: (evidence: PaymentEvidenceRef | undefined) => void;
};

const MIN_INK_PIXELS = 80;

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
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230) ink += 1;
  }
  return ink;
}

function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.round((payload.length * 3) / 4);
}

export function SignaturePad({ compact = false, required, value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const valueRef = useRef(value);
  const [signed, setSigned] = useState(Boolean(value?.previewUrl));
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
    const cssHeight = compact ? 120 : 156;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.max(1, Math.round(cssWidth * dpr));
    const nextH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width === nextW && canvas.height === nextH) return;
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
      return;
    }
    const canvas = canvasRef.current;
    if (canvas) fillWhite(canvas);
    setSigned(false);
  }, [value]);

  function emitSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (inkPixelCount(canvas) < MIN_INK_PIXELS) {
      onChange(undefined);
      setSigned(false);
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    onChange(
      buildSignatureEvidence(dataUrl, {
        mime: "image/png",
        byteSize: dataUrlBytes(dataUrl),
        width: canvas.width,
        height: canvas.height,
      }),
    );
    setSigned(true);
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = canvasPoint(canvas, event.nativeEvent);
    paintStrokeStyle(canvas);
    setSigned(true);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastRef.current;
    if (!canvas || !ctx || !last) return;
    event.preventDefault();
    const next = canvasPoint(canvas, event.nativeEvent);
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
    lastRef.current = null;
    setSigned(false);
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
    </div>
  );
}
