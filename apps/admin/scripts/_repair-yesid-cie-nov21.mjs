/**
 * Reparación autorizada (dueño 23/11): CIE Yesid N 21/11 y arrastre 23/11.
 * CIE-21 tenía cash_float = Inicial−gastos (2.127.500) en vez de la fórmula (2.313.500).
 *
 * Dry-run por defecto. Escribir: node scripts/_repair-yesid-cie-nov21.mjs --apply
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

const COB = "COB-1";
const D21 = "2026-11-21";
const D23 = "2026-11-23";
const REF21 = "CIE-COB-1-20261121";
const REF23 = "CIE-COB-1-20261123";

function formula(opening, ef, pre, gas) {
  return Math.trunc(opening) + Math.trunc(ef) - Math.trunc(pre) - Math.trunc(gas);
}

const own21 = await c.rpc("route_own_box", { p_collector_ref: COB, p_date: D21, p_route: "N" });
const o21 = own21.data;
if (!o21?.ok) {
  console.error("route_own_box 21 falló", own21.error || o21);
  process.exit(1);
}
const fix21 = formula(o21.opening, o21.efectivo, o21.prestamos, o21.gastos);
console.log("21 partes", {
  opening: o21.opening,
  efectivo: o21.efectivo,
  prestamos: o21.prestamos,
  gastos: o21.gastos,
  saldoCampo: o21.saldo,
  formula: fix21,
});

const { data: cie21 } = await c
  .from("day_closes")
  .select("ref,cash_float,movement_refs,updated_at")
  .eq("ref", REF21)
  .maybeSingle();
const { data: cie23 } = await c
  .from("day_closes")
  .select("ref,cash_float,movement_refs,updated_at")
  .eq("ref", REF23)
  .maybeSingle();

console.log("CIE 21 ahora", cie21?.cash_float, "→", fix21);
if (!cie23) {
  console.error("Falta CIE 23");
  process.exit(1);
}

// Tras corregir 21, el Inicial del 23 = fix21. Movimiento del 23 desde el CIE actual / box.
const own23 = await c.rpc("route_own_box", { p_collector_ref: COB, p_date: D23, p_route: "N" });
const o23 = own23.data;
if (!o23?.ok) {
  console.error("route_own_box 23 falló", own23.error || o23);
  process.exit(1);
}
const fix23 = formula(fix21, o23.efectivo, o23.prestamos, o23.gastos);
console.log("23 partes", {
  openingHoy: o23.opening,
  openingDebe: fix21,
  efectivo: o23.efectivo,
  prestamos: o23.prestamos,
  gastos: o23.gastos,
  saldoCampo: o23.saldo,
  formulaConInicialBueno: fix23,
});
console.log("CIE 23 ahora", cie23.cash_float, "→", fix23);

if (!apply) {
  console.log("Dry-run. Para escribir: node scripts/_repair-yesid-cie-nov21.mjs --apply");
  process.exit(0);
}

const stamp = new Date().toISOString();
const mark21 = `OWNER_REPAIR:formula|${D21}|${cie21.cash_float}->${fix21}|${stamp}`;
const mark23 = `OWNER_REPAIR:formula|${D23}|${cie23.cash_float}->${fix23}|${stamp}`;

const refs21 = [...(cie21.movement_refs || []), mark21];
const refs23 = [...(cie23.movement_refs || []), mark23];

const u21 = await c
  .from("day_closes")
  .update({
    cash_float: fix21,
    movement_refs: refs21,
    updated_at: stamp,
  })
  .eq("ref", REF21)
  .select("ref,cash_float");
if (u21.error) {
  console.error("update 21", u21.error);
  process.exit(1);
}
console.log("OK 21", u21.data);

const u23 = await c
  .from("day_closes")
  .update({
    cash_float: fix23,
    movement_refs: refs23,
    updated_at: stamp,
  })
  .eq("ref", REF23)
  .select("ref,cash_float");
if (u23.error) {
  console.error("update 23", u23.error);
  process.exit(1);
}
console.log("OK 23", u23.data);

const check21 = await c.rpc("route_own_box", { p_collector_ref: COB, p_date: D21, p_route: "N" });
const check23 = await c.rpc("route_own_box", { p_collector_ref: COB, p_date: D23, p_route: "N" });
console.log("post 21", check21.data);
console.log("post 23", check23.data);
console.log("listo");
