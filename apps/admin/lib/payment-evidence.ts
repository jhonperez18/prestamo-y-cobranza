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

/** Vista previa demo (solo semillas / pruebas). No usar en UI de cobros reales. */
export const DEMO_RECEIPT_PREVIEW = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect fill="#eee" width="120" height="160"/><text x="60" y="84" text-anchor="middle" font-size="11" fill="#888">Demo</text></svg>`,
)}`;

/** URL lista para mostrar en miniatura o lightbox.
 * Solo imagen real (`previewUrl`). No inventar comprobante demo:
 * eso hacía que el celular “viera” evidencia y el PC no.
 */
export function resolvePaymentEvidencePreview(receipt: PaymentEvidenceRef): string | null {
  const url = receipt.previewUrl?.trim();
  return url || null;
}

let evidenceCounter = 0;

export function newEvidenceId(prefix = "EV") {
  evidenceCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${evidenceCounter}`;
}

export function evidenceRequiredForMethod(method?: PaymentMethod | string) {
  const normalized = normalizePaymentMethod(method);
  return normalized === "nequi" || normalized === "efectivo";
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

export function paymentHasSignature(evidence?: PaymentEvidenceRef[]) {
  return paymentEvidenceOfKind(evidence, "firma").some(
    (row) => Boolean(resolvePaymentEvidencePreview(row)),
  );
}

/** Comprobante Nequi o firma de efectivo, el que esté disponible. */
export function primaryPaymentEvidence(evidence?: PaymentEvidenceRef[]) {
  const receipt = paymentEvidenceOfKind(evidence, "comprobante").find((row) =>
    Boolean(resolvePaymentEvidencePreview(row)),
  );
  if (receipt) return receipt;
  return paymentEvidenceOfKind(evidence, "firma").find((row) =>
    Boolean(resolvePaymentEvidencePreview(row)),
  );
}

export function paymentHasVisualEvidence(evidence?: PaymentEvidenceRef[]) {
  return Boolean(primaryPaymentEvidence(evidence));
}

export function validatePaymentEvidence(
  method: PaymentMethod | undefined,
  evidence: PaymentEvidenceRef[] | undefined,
) {
  const normalized = normalizePaymentMethod(method);
  if (normalized === "nequi") {
    if (!paymentHasReceipt(evidence)) {
      return "Nequi requiere foto del comprobante de transferencia.";
    }
    const receipt = paymentEvidenceOfKind(evidence, "comprobante")[0];
    if (receipt?.byteSize && receipt.byteSize > RECEIPT_MAX_BYTES) {
      return "La foto del comprobante supera el tamaño permitido (2 MB).";
    }
    return null;
  }
  if (normalized === "efectivo" && !paymentHasSignature(evidence)) {
    return "El cliente debe firmar el cobro en efectivo.";
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
  const id = newEvidenceId();
  return {
    id,
    kind: "comprobante",
    fileId: id,
    previewUrl: dataUrl,
    mime: meta.mime,
    byteSize: meta.byteSize,
    width: meta.width,
    height: meta.height,
    capturedAt: new Date().toISOString(),
  };
}

export function buildSignatureEvidence(dataUrl: string, meta: {
  mime: string;
  byteSize: number;
  width: number;
  height: number;
}): PaymentEvidenceRef {
  const id = newEvidenceId("SG");
  return {
    id,
    kind: "firma",
    fileId: id,
    previewUrl: dataUrl,
    mime: meta.mime,
    byteSize: meta.byteSize,
    width: meta.width,
    height: meta.height,
    capturedAt: new Date().toISOString(),
  };
}

/** True si alguna pieza trae la imagen real (data URL / URL firmada). */
export function evidenceHasPreview(evidence?: PaymentEvidenceRef[]) {
  return Boolean(evidence?.some((row) => Boolean(row.previewUrl?.trim())));
}

/**
 * Prefiere la evidencia que trae foto real; si ninguna, la que tenga refs.
 * Evita que un pull remoto (solo fileId) pise la constancia del celular.
 */
export function preferRicherEvidence(
  a?: PaymentEvidenceRef[],
  b?: PaymentEvidenceRef[],
): PaymentEvidenceRef[] | undefined {
  if (evidenceHasPreview(a)) return a;
  if (evidenceHasPreview(b)) return b;
  if (a?.length) return a;
  if (b?.length) return b;
  return undefined;
}

/**
 * Evidencia para mirror/DB.
 * Hasta tener bucket Storage, se incluye `previewUrl` (JPEG comprimido)
 * para que PC y celular vean la misma constancia Nequi.
 */
export function evidenceForMirror(evidence?: PaymentEvidenceRef[]): PaymentEvidenceRef[] | undefined {
  if (!evidence?.length) return undefined;
  return evidence.map((row) => {
    const previewUrl = row.previewUrl?.trim() || undefined;
    return {
      id: row.id,
      kind: row.kind,
      fileId: row.fileId || row.id,
      ...(previewUrl ? { previewUrl } : {}),
      mime: row.mime,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      capturedAt: row.capturedAt,
    };
  });
}
