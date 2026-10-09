/**
 * Cierre de mes del cobrador (MES-<cobrador>-<YYYY-MM>) compartido entre aparatos.
 * Storage `app-catalog/month-closes/<ref>.json`: un archivo por cierre (sin carreras).
 * Sin esto el «Día 1: guardar mes anterior» bloqueaba el cobro en todo aparato que no
 * fuera el que guardó el mes.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";
import type { CollectorMonthCloseRecord } from "@/lib/collector-day-close";
import { DEMO_COLLECTOR_MONTH_CLOSES_KEY, readDemoJson, writeDemoJson } from "@/lib/demo-persist";
import { emitMirrorQueueChanged, shouldDropFromMirrorQueue, type MirrorApiJson } from "@/lib/supabase/mirror-queue";

const STORAGE_BUCKET = "app-catalog";
const FOLDER = "month-closes";
export const DEMO_MONTH_CLOSE_MIRROR_QUEUE_KEY = "nexo-demo-month-close-mirror-queue";

const REF_PATTERN = /^MES-[A-Za-z0-9-]+-\d{4}-\d{2}$/;

export function normalizeMonthClose(raw: unknown): CollectorMonthCloseRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const ref = String(row.ref || "").trim();
  const period = String(row.period || "").trim();
  const collectorRef = String(row.collectorRef || "").trim();
  if (!REF_PATTERN.test(ref) || !/^\d{4}-\d{2}$/.test(period) || !collectorRef) return null;
  return {
    ref,
    collectorRef,
    collectorName: String(row.collectorName || "").trim(),
    period,
    closingSaldo: Math.trunc(Number(row.closingSaldo) || 0),
    closedAt: String(row.closedAt || "").trim() || new Date().toISOString(),
  };
}

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

/** Servidor: guarda un cierre de mes. Uno ya guardado en la nube no lo pisa uno más viejo. */
export async function writeMonthClose(raw: unknown) {
  const record = normalizeMonthClose(raw);
  if (!record) return { ok: true as const, skipped: true as const, reason: "invalid_month_close" };
  const supabase = storageClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const path = `${FOLDER}/${record.ref}.json`;
  const { data: current } = await downloadCatalogFile(supabase, STORAGE_BUCKET, path);
  if (current) {
    try {
      const existing = normalizeMonthClose(JSON.parse(await current.text()));
      if (existing && existing.closedAt > record.closedAt) {
        return { ok: true as const, kept: true as const };
      }
    } catch (err) {
      console.error("month-close-read", record.ref, err);
    }
  }
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, Buffer.from(JSON.stringify(record), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/** Servidor: todos los cierres de mes. */
export async function listMonthCloses(): Promise<
  { ok: true; closes: CollectorMonthCloseRecord[] } | { ok: false; error: string }
> {
  const supabase = storageClient();
  if (!supabase) return { ok: true, closes: [] };
  const { data: files, error } = await supabase.storage.from(STORAGE_BUCKET).list(FOLDER, { limit: 1000 });
  if (error) return { ok: false, error: error.message };
  const names = (files ?? []).map((file) => file.name).filter((name) => name.endsWith(".json"));
  const rows = await Promise.all(
    names.map(async (name) => {
      const { data, error: readError } = await downloadCatalogFile(supabase, STORAGE_BUCKET, `${FOLDER}/${name}`);
      if (readError || !data) {
        throw new Error(`month_close_read_failed:${name}:${readError?.message || "sin datos"}`);
      }
      return normalizeMonthClose(JSON.parse(await data.text()));
    }),
  );
  return { ok: true, closes: rows.filter((row): row is CollectorMonthCloseRecord => Boolean(row)) };
}

function readQueue() {
  return readDemoJson<CollectorMonthCloseRecord[]>(DEMO_MONTH_CLOSE_MIRROR_QUEUE_KEY, []).filter((row) => row?.ref);
}

function writeQueue(rows: CollectorMonthCloseRecord[]) {
  writeDemoJson(DEMO_MONTH_CLOSE_MIRROR_QUEUE_KEY, rows);
  emitMirrorQueueChanged();
}

/** Cliente: encola un cierre de mes (el flush lo sube). */
export function queueMonthCloseMirror(record: CollectorMonthCloseRecord) {
  if (typeof window === "undefined") return;
  writeQueue([...readQueue().filter((row) => row.ref !== record.ref), record]);
}

/** Cliente: sube la cola. Lo que la nube no aceptó se queda para el próximo intento. */
export async function flushMonthCloseMirrorQueue() {
  if (typeof window === "undefined") return;
  const left: CollectorMonthCloseRecord[] = [];
  for (const record of readQueue()) {
    try {
      const res = await fetch("/api/ops/month-closes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ close: record }),
        keepalive: true,
      });
      const json = (await res.json()) as MirrorApiJson;
      if (!(res.ok && shouldDropFromMirrorQueue(json))) left.push(record);
    } catch (error) {
      console.error("month-close-flush", record.ref, error);
      left.push(record);
    }
  }
  writeQueue(left);
}

/**
 * Cliente: baja los cierres de mes de la nube (unión por ref; gana el más reciente) y
 * encola los que solo están en este aparato.
 */
export async function pullRemoteMonthClosesIntoDemo(): Promise<{ ok: boolean; changed: boolean; reason?: string }> {
  if (typeof window === "undefined") return { ok: true, changed: false };
  try {
    const res = await fetch("/api/ops/month-closes", { cache: "no-store" });
    const body = (await res.json()) as { ok?: boolean; closes?: unknown[]; error?: string };
    if (!res.ok || !body.ok) return { ok: false, changed: false, reason: body.error || `http_${res.status}` };
    const remote = (body.closes ?? [])
      .map(normalizeMonthClose)
      .filter((row): row is CollectorMonthCloseRecord => Boolean(row));
    const local = readDemoJson<CollectorMonthCloseRecord[]>(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []).filter(
      (row) => row?.ref,
    );
    const byRef = new Map(local.map((row) => [row.ref, row]));
    let changed = false;
    for (const row of remote) {
      const prev = byRef.get(row.ref);
      if (!prev || row.closedAt > prev.closedAt) {
        byRef.set(row.ref, row);
        changed = true;
      }
    }
    const remoteRefs = new Set(remote.map((row) => row.ref));
    const localOnly = local.filter((row) => !remoteRefs.has(row.ref));
    for (const row of localOnly) queueMonthCloseMirror(row);
    if (changed) writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, [...byRef.values()]);
    if (localOnly.length) await flushMonthCloseMirrorQueue();
    return { ok: true, changed };
  } catch (error) {
    return { ok: false, changed: false, reason: error instanceof Error ? error.message : "month_close_pull_failed" };
  }
}
