// Respaldo diario de Supabase (solo lectura). Lo corre el timer autoprestamos-respaldo a las 23:45 Bogotá.
// Copia en el VPS: /root/respaldo/respaldo-diario.cjs (esta es la versionada).
const fs = require("fs");
const path = require("path");
const { createClient } = require("/var/www/autoprestamos/apps/admin/node_modules/@supabase/supabase-js");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE = 1000;
const s = createClient(URL_, KEY, { auth: { persistSession: false } });

/** Tablas con su llave. Las vistas (sin llave) se rehacen solas desde las tablas: no se guardan. */
async function listTables() {
  const res = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`lista de tablas: HTTP ${res.status}`);
  const spec = await res.json();
  const tables = [];
  const views = [];
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    const pk = Object.entries(def.properties || {})
      .filter(([, col]) => /<pk\/>/.test(col.description || ""))
      .map(([col]) => col);
    if (pk.length) tables.push({ name, pk });
    else views.push(name);
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables, views: views.sort() };
}

/** Páginas en orden fijo por la llave: sin orden, la base puede repetir o saltar filas entre páginas. */
async function dumpTable({ name, pk }) {
  const { count, error: countError } = await s.from(name).select("*", { count: "exact", head: true });
  if (countError) throw new Error(`${name} (conteo): ${countError.message}`);
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = s.from(name).select("*");
    for (const col of pk) query = query.order(col, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const ids = new Set(rows.map((row) => pk.map((col) => row[col]).join("|")));
  if (ids.size !== rows.length) throw new Error(`${name}: filas repetidas (${rows.length} filas, ${ids.size} llaves)`);
  if (rows.length < count) throw new Error(`${name}: bajaron ${rows.length} de ${count} filas`);
  return rows;
}

async function listFiles(bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await s.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`storage ${bucket}/${prefix}: ${error.message}`);
    for (const item of data || []) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) out.push(full);
      else out.push(...(await listFiles(bucket, full)));
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

(async () => {
  const dir = process.argv[2];
  if (!dir) throw new Error("falta carpeta destino");
  fs.mkdirSync(dir, { recursive: true });
  const { tables, views } = await listTables();
  const resumen = { inicio: new Date().toISOString(), tablas: {}, vistasSinGuardar: views, storage: {} };

  for (const table of tables) {
    const rows = await dumpTable(table);
    fs.writeFileSync(path.join(dir, `${table.name}.json`), JSON.stringify(rows));
    resumen.tablas[table.name] = rows.length;
  }

  const { data: buckets, error } = await s.storage.listBuckets();
  if (error) throw new Error(`buckets: ${error.message}`);
  for (const bucket of buckets || []) {
    if (bucket.name === "respaldos") continue;
    const files = await listFiles(bucket.name);
    for (const file of files) {
      const { data, error: dlError } = await s.storage.from(bucket.name).download(file);
      if (dlError) throw new Error(`descarga ${bucket.name}/${file}: ${dlError.message}`);
      const target = path.join(dir, "storage", bucket.name, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await data.arrayBuffer()));
    }
    resumen.storage[bucket.name] = files.length;
  }

  resumen.fin = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "_resumen.json"), JSON.stringify(resumen, null, 2));
  console.log(JSON.stringify(resumen));
})().catch((err) => {
  console.error("FALLA:", err.message);
  process.exit(1);
});
