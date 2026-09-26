/**
 * Sube CIE-COB-0-2026-09-25 = 2.704.000 a Supabase (service role).
 * Uso: node scripts/force-cie-cristian.mjs
 * (desde apps/admin; lee .env.local)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const REF = "CIE-COB-0-2026-09-25";
const FLOAT = 2_704_000;
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const row = {
  ref: REF,
  collector_ref: "COB-0",
  collector_name: "Cristian",
  close_date: "2026-09-25",
  route_ref: "M",
  collected: 0,
  expenses: [],
  expenses_total: 0,
  cash_float: FLOAT,
  cash_expected: FLOAT,
  cash_declared: FLOAT,
  cash_variance: 0,
  opening_cash: 0,
  closed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  movement_refs: [],
};

const { error } = await client.from("day_closes").upsert(row, { onConflict: "ref" });
if (error) {
  console.error("UPSERT falló:", error.message);
  process.exit(1);
}

const { data, error: readErr } = await client
  .from("day_closes")
  .select("ref,cash_float,updated_at")
  .eq("ref", REF)
  .maybeSingle();

if (readErr) {
  console.error("Lectura falló:", readErr.message);
  process.exit(1);
}

console.log("OK forzado:", data);
