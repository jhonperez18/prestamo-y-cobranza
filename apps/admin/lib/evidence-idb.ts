/**
 * Fotos de constancia. No viven en localStorage: ese cupo es de cobros,
 * clientes, usuarios y de la sesión. Si la foto se mete ahí, el login no cabe.
 */
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";

const DB_NAME = "nexo-evidence";
const STORE = "receipts";
const MAP_KEY = "map";
const EVIDENCE_KEY = "nexo-demo-payment-evidence";
const PAYMENTS_KEY = "nexo-demo-payments";

export type EvidenceMap = Record<string, PaymentEvidenceRef[]>;

function backupKey(key: string) {
  return `${key}-bak`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("evidence-idb-open"));
  });
}

export async function readEvidenceMapFromIdb(): Promise<EvidenceMap> {
  if (typeof indexedDB === "undefined") return {};
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(MAP_KEY);
      request.onsuccess = () => {
        const value = request.result as EvidenceMap | undefined;
        resolve(value && typeof value === "object" ? value : {});
      };
      request.onerror = () => reject(request.error ?? new Error("evidence-idb-read"));
    });
  } finally {
    db.close();
  }
}

export async function writeEvidenceMapToIdb(map: EvidenceMap): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const request = tx.objectStore(STORE).put(map, MAP_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("evidence-idb-write"));
    });
  } finally {
    db.close();
  }
}

function isEvidenceRow(value: unknown): value is PaymentEvidenceRef {
  if (!value || typeof value !== "object") return false;
  const row = value as PaymentEvidenceRef;
  return typeof row.id === "string";
}

function hasDataPreview(rows: PaymentEvidenceRef[]) {
  return rows.some(
    (row) => typeof row.previewUrl === "string" && row.previewUrl.startsWith("data:"),
  );
}

function absorbPayments(raw: string | null, into: EvidenceMap) {
  if (!raw || !raw.includes("data:")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const payment = row as { ref?: string; evidence?: unknown };
    const ref = payment.ref?.trim();
    if (!ref || !Array.isArray(payment.evidence)) continue;
    const evidence = payment.evidence.filter(isEvidenceRow);
    if (hasDataPreview(evidence)) into[ref] = evidence;
  }
}

function absorbEvidenceMap(raw: string | null, into: EvidenceMap) {
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const [ref, rows] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const evidence = rows.filter(isEvidenceRow);
    if (evidence.length) into[ref] = evidence;
  }
}

function jsonWithoutDataPreviews(value: unknown) {
  return JSON.stringify(value, (key, entry) => {
    if (key === "previewUrl" && typeof entry === "string" && entry.startsWith("data:")) {
      return undefined;
    }
    return entry;
  });
}

/**
 * Saca las fotos de localStorage y las deja en IndexedDB.
 * Borra la copia -bak de esas fotos. Los cobros (monto, fecha, método) siguen.
 */
export async function parkLocalBlobs(): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  const evidenceRaw = window.localStorage.getItem(EVIDENCE_KEY);
  const evidenceBak = window.localStorage.getItem(backupKey(EVIDENCE_KEY));
  const paymentsRaw = window.localStorage.getItem(PAYMENTS_KEY);
  const paymentsBak = window.localStorage.getItem(backupKey(PAYMENTS_KEY));
  const crowded = [evidenceRaw, evidenceBak, paymentsRaw, paymentsBak].some(
    (raw) => Boolean(raw?.includes("data:")),
  );
  if (!crowded && !evidenceRaw) return;

  const map = await readEvidenceMapFromIdb();
  absorbEvidenceMap(evidenceRaw, map);
  absorbEvidenceMap(evidenceBak, map);
  absorbPayments(paymentsRaw, map);
  absorbPayments(paymentsBak, map);
  if (Object.keys(map).length > 0) await writeEvidenceMapToIdb(map);

  window.localStorage.removeItem(EVIDENCE_KEY);
  window.localStorage.removeItem(backupKey(EVIDENCE_KEY));
  if (paymentsBak?.includes("data:")) {
    window.localStorage.removeItem(backupKey(PAYMENTS_KEY));
  }
  if (paymentsRaw?.includes("data:")) {
    try {
      const parsed = JSON.parse(paymentsRaw) as unknown;
      window.localStorage.setItem(PAYMENTS_KEY, jsonWithoutDataPreviews(parsed));
    } catch (error) {
      console.error("park-payments", error);
    }
  }
}
