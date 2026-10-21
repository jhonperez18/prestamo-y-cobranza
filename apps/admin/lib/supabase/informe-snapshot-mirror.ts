/**
 * Copias del informe mensual en Storage. Una por mes y panel.
 * Si el archivo ya está, se queda: no se vuelve a calcular.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";
import {
  informeSnapshotRef,
  normalizeInformeSnapshot,
  type InformeMonthSnapshot,
  type InformeSnapshotScope,
} from "@/lib/informe-month-snapshot";

const STORAGE_BUCKET = "app-catalog";
const FOLDER = "informe-snapshots";

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

function pathOf(ref: string) {
  return `${FOLDER}/${ref}.json`;
}

export async function readInformeSnapshot(scope: InformeSnapshotScope, period: string) {
  const supabase = storageClient();
  if (!supabase) return { ok: true as const, snapshot: null as InformeMonthSnapshot | null };
  const ref = informeSnapshotRef(scope, period);
  const { data, error } = await downloadCatalogFile(supabase, STORAGE_BUCKET, pathOf(ref));
  if (error || !data) {
    if (/not.?found|404|object/i.test(error?.message || "")) {
      return { ok: true as const, snapshot: null };
    }
    if (!error && !data) return { ok: true as const, snapshot: null };
    return { ok: false as const, error: error?.message || "informe_snapshot_read_failed" };
  }
  try {
    return { ok: true as const, snapshot: normalizeInformeSnapshot(JSON.parse(await data.text())) };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "informe_snapshot_parse_failed",
    };
  }
}

export async function writeInformeSnapshotOnce(snapshot: InformeMonthSnapshot) {
  const current = await readInformeSnapshot(snapshot.scope, snapshot.period);
  if (!current.ok) return current;
  if (current.snapshot) return { ok: true as const, kept: true as const };
  const supabase = storageClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(pathOf(snapshot.ref), Buffer.from(JSON.stringify(snapshot), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, kept: false as const };
}

export async function listInformeSnapshots(): Promise<
  { ok: true; snapshots: InformeMonthSnapshot[] } | { ok: false; error: string }
> {
  const supabase = storageClient();
  if (!supabase) return { ok: true, snapshots: [] };
  const { data: files, error } = await supabase.storage.from(STORAGE_BUCKET).list(FOLDER, { limit: 200 });
  if (error) {
    if (/not.?found|404|object/i.test(error.message)) return { ok: true, snapshots: [] };
    return { ok: false, error: error.message };
  }
  const names = (files ?? []).map((file) => file.name).filter((name) => name.endsWith(".json"));
  try {
    const rows = await Promise.all(
      names.map(async (name) => {
        const { data, error: readError } = await downloadCatalogFile(
          supabase,
          STORAGE_BUCKET,
          `${FOLDER}/${name}`,
        );
        if (readError || !data) {
          throw new Error(readError?.message || `informe_snapshot_read_failed:${name}`);
        }
        return normalizeInformeSnapshot(JSON.parse(await data.text()));
      }),
    );
    const snapshots = rows
      .filter((row): row is InformeMonthSnapshot => Boolean(row))
      .sort((a, b) => b.period.localeCompare(a.period));
    return { ok: true, snapshots };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "informe_snapshot_list_failed" };
  }
}
