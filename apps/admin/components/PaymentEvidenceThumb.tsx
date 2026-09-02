"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatEvidenceSize,
  paymentEvidenceOfKind,
  resolvePaymentEvidencePreview,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";

type Props = {
  evidence?: PaymentEvidenceRef[];
  /** Tamaño de la miniatura en px (solo variant thumb). */
  size?: number;
  emptyLabel?: string;
  /** thumb = celda de tabla; panel = ficha con imagen grande */
  variant?: "thumb" | "panel";
};

function EvidenceLightbox({
  openUrl,
  sizeHint,
  isDemoPreview,
  onClose,
}: {
  openUrl: string;
  sizeHint: string;
  isDemoPreview: boolean;
  onClose: () => void;
}) {
  return (
    <div className="evidence-lightbox" role="dialog" aria-modal="true" aria-label="Comprobante">
      <button
        type="button"
        className="evidence-lightbox-backdrop"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="evidence-lightbox-panel">
        <header>
          <strong>Comprobante de pago</strong>
          {sizeHint !== "—" ? <span>{sizeHint}</span> : null}
          {isDemoPreview ? <span className="evidence-demo-tag">Demo</span> : null}
          <a
            className="btn ghost compact"
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            Abrir
          </a>
          <button type="button" className="btn ghost compact" onClick={onClose}>
            Cerrar
          </button>
        </header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={openUrl} alt="Comprobante ampliado" />
      </div>
    </div>
  );
}

export function PaymentEvidenceThumb({
  evidence,
  size = 40,
  emptyLabel = "—",
  variant = "thumb",
}: Props) {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const receipts = paymentEvidenceOfKind(evidence, "comprobante");
  const receipt = receipts[0];
  const previewUrl = receipt ? resolvePaymentEvidencePreview(receipt) : null;

  const close = useCallback(() => setOpenUrl(null), []);

  useEffect(() => {
    if (!openUrl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, openUrl]);

  if (!receipt || !previewUrl) {
    return <span className="payment-evidence-empty">{emptyLabel}</span>;
  }

  const sizeHint = formatEvidenceSize(receipt.byteSize);
  const isDemoPreview = !receipt.previewUrl?.trim();
  const title = `Ver comprobante ampliado${sizeHint !== "—" ? ` · ${sizeHint}` : ""}`;

  if (variant === "panel") {
    return (
      <>
        <div className="payment-evidence-panel">
          <button
            type="button"
            className="payment-evidence-panel-btn"
            title={title}
            aria-label="Ampliar comprobante"
            onClick={() => setOpenUrl(previewUrl)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Comprobante de pago" />
          </button>
          <p className="payment-evidence-panel-hint">Clic en la imagen para verla a pantalla completa</p>
        </div>
        {openUrl ? (
          <EvidenceLightbox
            openUrl={openUrl}
            sizeHint={sizeHint}
            isDemoPreview={isDemoPreview}
            onClose={close}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="payment-evidence-thumb"
        title={title}
        aria-label="Ver comprobante ampliado"
        onClick={(event) => {
          event.stopPropagation();
          setOpenUrl(previewUrl);
        }}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Comprobante de pago" />
      </button>

      {openUrl ? (
        <EvidenceLightbox
          openUrl={openUrl}
          sizeHint={sizeHint}
          isDemoPreview={isDemoPreview}
          onClose={close}
        />
      ) : null}
    </>
  );
}
