/**
 * Urgencia 01/11: CIE Edgar 31/10 quedó en 827.000 (= caja A).
 * Cadena M↔T ese día (day_final) = 82.000. A sigue en 827.000 vía AJUSTE@A.
 *
 * Uso (apps/admin): node scripts/fix-cie-edgar-31-a.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, "..", ".env.local");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta SUPABASE en .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const REF = "CIE-COB-0-20261031";
const DATE = "2026-10-31";

const { data: fig, error: figErr } = await sb.rpc("day_cash_figure", {
  p_collector_ref: "COB-0",
  p_date: DATE,
});
if (figErr) {
  console.error("day_cash_figure", figErr.message);
  process.exit(1);
}
const dayFinal = Math.trunc(Number(fig?.day_final ?? fig?.calculado) || 0);
if (!(dayFinal >= 0)) {
  console.error("day_final inválido", fig);
  process.exit(1);
}

const { data: box, error: boxErr } = await sb.rpc("route_own_box", {
  p_collector_ref: "COB-0",
  p_date: DATE,
  p_route: "A",
});
if (boxErr || box?.ok !== true) {
  console.error("route_own_box A", boxErr?.message || box);
  process.exit(1);
}
const aSaldo = Math.trunc(Number(box.saldo) || 0);

const { data: cie, error: cieErr } = await sb
  .from("day_closes")
  .select("ref,cash_float,movement_refs")
  .eq("ref", REF)
  .maybeSingle();
if (cieErr || !cie) {
  console.error("CIE", cieErr?.message || "no encontrado");
  process.exit(1);
}

const prevFloat = Math.trunc(Number(cie.cash_float) || 0);
const refs = Array.isArray(cie.movement_refs) ? [...cie.movement_refs] : [];
const mark = `FIX_CIE_CHAIN:${prevFloat}->${dayFinal}|A=${aSaldo}`;
const ajuste = `AJUSTE@A:${aSaldo}|${aSaldo}|${new Date().toISOString()}|reparacion-01nov|cierre A no pisa CIE cadena`;
if (!refs.some((r) => String(r).startsWith("FIX_CIE_CHAIN:"))) refs.push(mark);
if (!refs.some((r) => String(r).startsWith("AJUSTE@A:"))) refs.push(ajuste);

const { error: upErr } = await sb
  .from("day_closes")
  .update({
    cash_float: dayFinal,
    cash_expected: dayFinal,
    cash_declared: dayFinal,
    movement_refs: refs,
    updated_at: new Date().toISOString(),
  })
  .eq("ref", REF);

if (upErr) {
  console.error("update", upErr.message);
  process.exit(1);
}

const { data: open } = await sb.rpc("chain_m_opening", {
  p_collector_ref: "COB-0",
  p_date: "2026-11-01",
});
const { data: aHoy } = await sb.rpc("route_own_box", {
  p_collector_ref: "COB-0",
  p_date: "2026-11-01",
  p_route: "A",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      cieAntes: prevFloat,
      cieAhora: dayFinal,
      a31: aSaldo,
      inicialM_01nov: open,
      a_01nov: aHoy,
    },
    null,
    2,
  ),
);
