/**
 * Estado de cada aparato (versión, último sync, cola sin subir) en Storage:
 * `app-catalog/devices/<deviceId>.json`. Un archivo por aparato: sin carreras entre celulares.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeDeviceStatus, type DeviceStatus } from "@/lib/device-status";

const STORAGE_BUCKET = "app-catalog";
const DEVICES_FOLDER = "devices";

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

export async function writeDeviceStatus(raw: unknown) {
  const status = normalizeDeviceStatus(raw);
  if (!status) return { ok: true as const, skipped: true as const, reason: "invalid_device" };
  const supabase = storageClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const stamped: DeviceStatus = { ...status, reportedAt: new Date().toISOString() };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(`${DEVICES_FOLDER}/${stamped.deviceId}.json`, Buffer.from(JSON.stringify(stamped), "utf8"), {
      contentType: "application/json",
      upsert: true,
    });
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
  const names = (files ?? []).map((file) => file.name).filter((name) => name.endsWith(".json"));
  const rows = await Promise.all(
    names.map(async (name) => {
      try {
        const { data, error: readError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(`${DEVICES_FOLDER}/${name}`);
        if (readError || !data) return null;
        return normalizeDeviceStatus(JSON.parse(await data.text()));
      } catch (err) {
        console.error("device-status-read", name, err);
        return null;
      }
    }),
  );
  const devices = rows
    .filter((row): row is DeviceStatus => Boolean(row))
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  return { ok: true, devices };
}
