import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Archivos JSON de Storage que se leen y se reescriben (catálogos, cierres de mes, informes).
 * Con la caché por defecto (`max-age=3600`) un guardado leía la versión de hace una hora
 * y pisaba lo anterior (marcas de las cuentas Banco, 09/10). Se escriben sin caché y se leen frescos.
 */
export const CATALOG_FILE_UPLOAD = {
  contentType: "application/json",
  upsert: true,
  cacheControl: "0",
} as const;

export function downloadCatalogFile(client: SupabaseClient, bucket: string, path: string) {
  return client.storage.from(bucket).download(path, { cacheNonce: `${Date.now()}` });
}
