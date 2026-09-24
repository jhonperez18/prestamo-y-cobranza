/**
 * Sube constancias (firma / Nequi) al bucket privado `evidence`.
 * Postgres solo guarda el path liviano — nunca Base64.
 * @see docs/storage.md
 */
import { createSupabaseAdminClient, createMirrorServerClient } from "@/lib/supabase/admin";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import { evidenceForMirror } from "@/lib/payment-evidence";

export const PAYMENT_EVIDENCE_BUCKET = "evidence";

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").trim();
  const b64 = match[2] || "";
  try {
    const binary = Buffer.from(b64, "base64");
    return { mime, bytes: new Uint8Array(binary) };
  } catch {
    return null;
  }
}

function evidenceStoragePath(paymentRef: string, row: PaymentEvidenceRef) {
  const fileId = (row.fileId || row.id || "file").replace(/[^\w.-]+/g, "_");
  const folder = row.kind === "firma" ? "signatures" : "evidence";
  return `payments/${paymentRef}/${folder}/${fileId}`;
}

/**
 * Si hay `data:` en evidencia, intenta subir al bucket y deja solo el path.
 * Si el bucket no existe o falla la red: igual devuelve refs sin Base64
 * (el dinero se registra; la foto sigue en IndexedDB del aparato).
 */
export async function materializeEvidenceForDatabase(
  paymentRef: string,
  evidence?: PaymentEvidenceRef[],
): Promise<PaymentEvidenceRef[] | undefined> {
  if (!evidence?.length) return undefined;
  const ref = paymentRef.trim();
  if (!ref) return evidenceForMirror(evidence);

  const client = storageClient();
  const out: PaymentEvidenceRef[] = [];

  for (const row of evidence) {
    const preview = row.previewUrl?.trim();
    const alreadyHttps = Boolean(preview && /^https?:\/\//i.test(preview));
    const alreadyPath =
      Boolean(row.fileId?.includes("/")) && !row.fileId?.startsWith("data:");

    if ((alreadyHttps || alreadyPath) && !preview?.startsWith("data:")) {
      const light = evidenceForMirror([row]);
      if (light?.[0]) out.push(light[0]);
      continue;
    }

    if (preview?.startsWith("data:") && client) {
      const parsed = parseDataUrl(preview);
      if (parsed) {
        const path = evidenceStoragePath(ref, row);
        const { error } = await client.storage.from(PAYMENT_EVIDENCE_BUCKET).upload(path, parsed.bytes, {
          contentType: row.mime || parsed.mime,
          upsert: true,
        });
        if (!error) {
          out.push({
            id: row.id,
            kind: row.kind,
            fileId: path,
            mime: row.mime || parsed.mime,
            byteSize: row.byteSize ?? parsed.bytes.byteLength,
            width: row.width,
            height: row.height,
            capturedAt: row.capturedAt,
          });
          continue;
        }
      }
    }

    const light = evidenceForMirror([row]);
    if (light?.[0]) out.push(light[0]);
  }

  return out.length ? out : undefined;
}
