/**
 * Estado de cada aparato (versión, último sync, cola sin subir) en Storage:
 * `app-catalog/devices/<deviceId>.json`. Un archivo por aparato: sin carreras entre celulares.
 *
 * Vercel (`*.vercel.app`) ya no es producción: no se aceptan reportes ni se listan.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";
import { DEVICE_ALERT_WINDOW_MS } from "@/lib/device-storage-alerts";
import { normalizeDeviceStatus, type DeviceStatus } from "@/lib/device-status";

const STORAGE_BUCKET = "app-catalog";
const DEVICES_FOLDER = "devices";

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

function isRetiredHost(host: string) {
  return /vercel\.app/i.test(host);
}

function isLiveReport(row: DeviceStatus, now = Date.now()) {
  const at = Date.parse(row.reportedAt);
  return Number.isFinite(at) && now - at <= DEVICE_ALERT_WINDOW_MS;
}

export async function writeDeviceStatus(raw: unknown) {
  const status = normalizeDeviceStatus(raw);
  if (!status) return { ok: true as const, skipped: true as const, reason: "invalid_device" };
  // Mundo viejo: no guardar reportes desde Vercel (no pueden volver a aparecer).
  if (isRetiredHost(status.host)) {
    return { ok: true as const, skipped: true as const, reason: "vercel_retired" };
  }
  const supabase = storageClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const stamped: DeviceStatus = { ...status, reportedAt: new Date().toISOString(), firstSeenAt: "" };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(`${DEVICES_FOLDER}/${stamped.deviceId}.json`, Buffer.from(JSON.stringify(stamped), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function listDeviceStatuses(): Promise<
  { ok: true; devices: DeviceStatus[] } | { ok: false; error: string }
> {
  const supabase = storageClient();
  if (!supabase) return { ok: true, devices: [] };
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(DEVICES_FOLDER, { limit: 200 });
  if (error) return { ok: false, error: error.message };
  const now = Date.now();
  // No descargar JSON viejo: cada apertura del panel / morning-check gastaba egress.
  const entries = (files ?? []).filter((file) => {
    if (!file.name.endsWith(".json")) return false;
    const stamp = Date.parse(String(file.updated_at || file.created_at || ""));
    if (Number.isFinite(stamp) && now - stamp > DEVICE_ALERT_WINDOW_MS) return false;
    return true;
  });
  const rows = await Promise.all(
    entries.map(async ({ name, created_at: createdAt }) => {
      try {
        const { data, error: readError } = await downloadCatalogFile(
          supabase,
          STORAGE_BUCKET,
          `${DEVICES_FOLDER}/${name}`,
        );
        if (readError || !data) return null;
        const row = normalizeDeviceStatus(JSON.parse(await data.text()));
        // El upsert conserva `created_at` del objeto: es la primera vez que la nube vio el aparato.
        return row ? { ...row, firstSeenAt: createdAt || "" } : null;
      } catch (err) {
        console.error("device-status-read", name, err);
        return null;
      }
    }),
  );
  const devices = rows
    .filter((row): row is DeviceStatus => Boolean(row))
    // Fantasmas: Vercel / prueba / sin reporte reciente (no bajar ni pintar basura).
    .filter(
      (row) =>
        !isRetiredHost(row.host) &&
        !/^cristian$/i.test(String(row.userName || "").trim()) &&
        isLiveReport(row, now),
    )
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  return { ok: true, devices };
}
