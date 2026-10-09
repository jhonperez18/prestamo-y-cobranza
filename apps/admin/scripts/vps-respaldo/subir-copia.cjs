// Segunda copia fuera del VPS: el tar de datos (tablas, sin fotos) va al depósito privado
// `respaldos` de Supabase y se guardan 7 días. Las fotos ya viven en Supabase: su copia es la del VPS.
// Copia en el VPS: /root/respaldo/subir-copia.cjs (esta es la versionada).
const fs = require("fs");
const path = require("path");
const { createClient } = require("/var/www/autoprestamos/apps/admin/node_modules/@supabase/supabase-js");

const BUCKET = "respaldos";
const KEEP = 7;
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function ensureBucket() {
  const { data, error } = await s.storage.getBucket(BUCKET);
  if (data && !error) {
    if (data.public) throw new Error(`el depósito ${BUCKET} es público`);
    return;
  }
  const { error: createError } = await s.storage.createBucket(BUCKET, { public: false });
  if (createError) throw new Error(`crear depósito: ${createError.message}`);
}

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error("falta el archivo a subir");
  await ensureBucket();
  const name = path.basename(file);
  const { error } = await s.storage
    .from(BUCKET)
    .upload(name, fs.readFileSync(file), { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(`subida: ${error.message}`);

  const { data: list, error: listError } = await s.storage
    .from(BUCKET)
    .list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (listError) throw new Error(`lista: ${listError.message}`);
  const old = (list || []).map((item) => item.name).slice(KEEP);
  if (old.length) {
    const { error: removeError } = await s.storage.from(BUCKET).remove(old);
    if (removeError) throw new Error(`borrar viejos: ${removeError.message}`);
  }
  console.log(`copia ${name} en ${BUCKET} (${(fs.statSync(file).size / 1024).toFixed(0)} KB); quedan ${Math.min(KEEP, (list || []).length)}`);
})().catch((err) => {
  console.error("FALLA copia:", err.message);
  process.exit(1);
});
