import type { PaymentMethod } from "@/lib/payment-method";
import { normalizePaymentMethod } from "@/lib/payment-method";

/** Tipo de archivo adjunto al pago. Extensible (firma, otro). */
export type PaymentEvidenceKind = "comprobante" | "firma";

/**
 * Referencia ligera a evidencia de pago.
 * En producción: `fileId` apunta al bucket; `previewUrl` solo en cliente temporal.
 * En listados admin se usa miniatura bajo demanda, no el binario completo.
 */
export type PaymentEvidenceRef = {
  id: string;
  kind: PaymentEvidenceKind;
  /** ID en storage (`payments/{payment_id}/evidence/{file_id}`). */
  fileId?: string;
  /** Vista previa local o URL firmada de corta duración. */
  previewUrl?: string;
  mime?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  capturedAt?: string;
};

export const RECEIPT_MAX_EDGE_PX = 1280;
export const RECEIPT_JPEG_QUALITY = 0.72;
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

/** Vista previa demo cuando el comprobante está registrado pero sin imagen en cliente. */
export const DEMO_RECEIPT_PREVIEW = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="600" viewBox="0 0 420 600">
  <rect fill="#eceff1" width="420" height="600"/>
  <rect fill="#fff" x="28" y="28" width="364" height="544" rx="10" stroke="#cfd8dc"/>
  <text x="210" y="78" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#00b386">Nequi</text>
  <text x="210" y="108" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#607d8b">Comprobante de transferencia</text>
  <line x1="56" y1="130" x2="364" y2="130" stroke="#e0e0e0"/>
  <text x="56" y="168" font-family="system-ui,sans-serif" font-size="13" fill="#78909c">Valor</text>
  <text x="364" y="168" text-anchor="end" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#263238">$ 5.000</text>
  <text x="56" y="210" font-family="system-ui,sans-serif" font-size="13" fill="#78909c">Estado</text>
  <text x="364" y="210" text-anchor="end" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#2e7d32">Exitosa</text>
  <text x="56" y="252" font-family="system-ui,sans-serif" font-size="13" fill="#78909c">Fecha</text>
  <text x="364" y="252" text-anchor="end" font-family="system-ui,sans-serif" font-size="14" fill="#37474f">27/08/2026 · 09:12</text>
  <rect fill="#f5f5f5" x="56" y="280" width="308" height="180" rx="6"/>
  <text x="210" y="378" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#90a4ae">Evidencia demo · ampliar para verificar</text>
</svg>
`)}`;

/** URL lista para mostrar en miniatura o lightbox. */
export function resolvePaymentEvidencePreview(receipt: PaymentEvidenceRef): string | null {
  if (receipt.previewUrl?.trim()) return receipt.previewUrl.trim();
  if (receipt.fileId) return DEMO_RECEIPT_PREVIEW;
  if (receipt.kind === "comprobante" && receipt.mime?.startsWith("image/")) {
    return DEMO_RECEIPT_PREVIEW;
  }
  return null;
}

let evidenceCounter = 0;

export function newEvidenceId(prefix = "EV") {
  evidenceCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${evidenceCounter}`;
}

export function evidenceRequiredForMethod(method?: PaymentMethod | string) {
  return normalizePaymentMethod(method) === "nequi";
}

export function paymentEvidenceOfKind(
  evidence: PaymentEvidenceRef[] | undefined,
  kind: PaymentEvidenceKind,
) {
  return evidence?.filter((row) => row.kind === kind) ?? [];
}

export function paymentHasReceipt(evidence?: PaymentEvidenceRef[]) {
  return paymentEvidenceOfKind(evidence, "comprobante").some(
    (row) => Boolean(resolvePaymentEvidencePreview(row)),
  );
}

export function validatePaymentEvidence(
  method: PaymentMethod | undefined,
  evidence: PaymentEvidenceRef[] | undefined,
) {
  if (!evidenceRequiredForMethod(method)) return null;
  if (!paymentHasReceipt(evidence)) {
    return "Nequi requiere foto del comprobante de transferencia.";
  }
  const receipt = paymentEvidenceOfKind(evidence, "comprobante")[0];
  if (receipt?.byteSize && receipt.byteSize > RECEIPT_MAX_BYTES) {
    return "La foto del comprobante supera el tamaño permitido (2 MB).";
  }
  return null;
}

export function formatEvidenceSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo comprimir la imagen."))),
      mime,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("No se pudo convertir la imagen."));
    reader.readAsDataURL(blob);
  });
}

/** Comprime la foto antes de guardarla — menos memoria en la app y menos peso al subir. */
export async function compressReceiptImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Solo se admiten imágenes JPG o PNG.");
  }

  const img = await loadImageFromFile(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > RECEIPT_MAX_EDGE_PX ? RECEIPT_MAX_EDGE_PX / longest : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.drawImage(img, 0, 0, width, height);

  let quality = RECEIPT_JPEG_QUALITY;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);

  while (blob.size > RECEIPT_MAX_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }

  if (blob.size > RECEIPT_MAX_BYTES) {
    throw new Error("La imagen sigue siendo muy pesada. Acerca más el comprobante o recorta la foto.");
  }

  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    mime: "image/jpeg" as const,
    byteSize: blob.size,
    width,
    height,
  };
}

export function buildReceiptEvidence(dataUrl: string, meta: {
  mime: string;
  byteSize: number;
  width: number;
  height: number;
}): PaymentEvidenceRef {
  return {
    id: newEvidenceId(),
    kind: "comprobante",
    previewUrl: dataUrl,
    mime: meta.mime,
    byteSize: meta.byteSize,
    width: meta.width,
    height: meta.height,
    capturedAt: new Date().toISOString(),
  };
}
