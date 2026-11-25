/**
 * Reparación autorizada: CIE Edgar 24/11 — P-823 Samir (A) no debe restar en M.
 * Dry-run por defecto. Escribir: node scripts/_repair-edgar-m-samir-nov24.mjs --apply
 *
 * No toca caja A (ya restó Samir bien). Solo CIE de cadena + arrastre Inicial M hoy.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const apply = process.argv.includes("--apply");
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const COB = "COB-0";
const D24 = "2026-11-24";
const D25 = "2026-11-25";
const REF24 = "CIE-COB-0-20261124";
const MARK = "REPAIR:A_NO_CADENA|P-823|2026-11-25";

const fig = await c.rpc("day_cash_figure", { p_collector_ref: COB, p_date: D24 });
if (fig.error || !fig.data?.ok) {
  console.error("day_cash_figure 24 falló — ¿aplicaste la migración?", fig.error || fig.data);
  process.exit(1);
}
const d = fig.data;
const mClose = Math.trunc(Number(d.m_closing) || 0);
const dayFinal = Math.trunc(Number(d.day_final) || 0);
const mPre = Math.trunc(Number(d.m_prestamos) || 0);
const ownPre = Math.trunc(Number(d.own_prestamos) || 0);

console.log("RPC 24 tras regla:", {
  m_prestamos: mPre,
  own_prestamos: ownPre,
  m_closing: mClose,
  day_final: dayFinal,
});

if (mClose !== 862600 || dayFinal !== 1274600 || mPre !== 1100000) {
  console.error("Cifras RPC no cuadran con el cuadre esperado (862600 / 1274600 / pre 1100000). Aborto.");
  process.exit(1);
}

const { data: cie } = await c
  .from("day_closes")
  .select("ref,cash_float,movement_refs,updated_at")
  .eq("ref", REF24)
  .maybeSingle();
if (!cie) {
  console.error("Falta", REF24);
  process.exit(1);
}

const refs = Array.isArray(cie.movement_refs) ? [...cie.movement_refs] : [];
const already = refs.some((r) => String(r).startsWith("REPAIR:A_NO_CADENA|P-823"));
console.log("CIE ahora", cie.cash_float, "→", dayFinal, already ? "(ya marcado)" : "");

const box = await c.rpc("route_own_box", { p_collector_ref: COB, p_date: D24, p_route: "A" });
console.log("Caja A 24 (no se toca):", {
  prestamos: box.data?.prestamos,
  saldo: box.data?.saldo,
});

const open25 = await c.rpc("chain_m_opening", { p_collector_ref: COB, p_date: D25 });
console.log("Inicial M hoy (antes):", open25.data?.opening, "→ tras CIE:", dayFinal);

if (!apply) {
  console.log("Dry-run. Para escribir: node scripts/_repair-edgar-m-samir-nov24.mjs --apply");
  process.exit(0);
}

if (already && Math.trunc(Number(cie.cash_float) || 0) === dayFinal) {
  console.log("Ya reparado. Nada que escribir.");
  process.exit(0);
}

if (!refs.includes(MARK)) refs.push(MARK);

const { error } = await c
  .from("day_closes")
  .update({
    cash_float: dayFinal,
    movement_refs: refs,
    updated_at: new Date().toISOString(),
  })
  .eq("ref", REF24);

if (error) {
  console.error("Update CIE falló", error);
  process.exit(1);
}

const openAfter = await c.rpc("chain_m_opening", { p_collector_ref: COB, p_date: D25 });
const figAfter = await c.rpc("day_cash_figure", { p_collector_ref: COB, p_date: D24 });
console.log("OK. CIE", dayFinal, "| Inicial M hoy", openAfter.data?.opening, "| m_closing", figAfter.data?.m_closing);
