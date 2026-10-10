/**
 * Fase Cierres (2a) · solo lectura: el servidor recalcula cada CIE- sellado con la nube
 * (`planServerSheetClose`, el mismo camino que el cierre del cobrador) y lo compara con lo guardado.
 * Uso (desde apps/admin): node scripts/shadow-close-audit.mjs [desde=2026-09-29]
 */
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-alias-loader.mjs", import.meta.url);
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { loadOperationalStateFromCloud } = await import("@/lib/server-day-rollover");
const { planServerSheetClose } = await import("@/lib/server-close-sheet");
const { normalizeHistoryDate } = await import("@/lib/collector-day-close");
const { isPlanillaCashChainRoute } = await import("@/lib/planilla-cash-chain");
const { assignmentRouteName } = await import("@/lib/collector-dispatch-sync");
const { businessTodayIso } = await import("@/lib/business-timezone");

const from = process.argv[2] || "2026-09-29";
const today = businessTodayIso();
const loaded = await loadOperationalStateFromCloud();
if (!loaded.ok) throw new Error(loaded.error);
const state = loaded.state;
const iso = (raw) => normalizeHistoryDate(raw) || raw;
const money = (n) => (n == null ? "—" : Math.round(n).toLocaleString("es-CO"));

const cies = state.dayCloses
  .filter((row) => !row.provisional && iso(row.date) >= from && iso(row.date) < today)
  .sort((a, b) => iso(a.date).localeCompare(iso(b.date)) || a.collectorRef.localeCompare(b.collectorRef));

let same = 0;
const diffs = [];
for (const cie of cies) {
  const date = iso(cie.date);
  const sameDay = (row) => row.collectorRef === cie.collectorRef && iso(row.date) === date;
  const visits = state.assignments.filter(
    (row) => row.collectorRef === cie.collectorRef && iso(row.dispatchDate) === date,
  );
  const routes = new Set(visits.map((row) => assignmentRouteName(row, state.clients)).filter(Boolean));
  const chain = [...routes].some((name) => isPlanillaCashChainRoute(name));
  const route = chain ? "T" : [...routes][0];
  // Momento del último cierre: sin el CIE- de ese día ni el PCE-T; el gasto que tenía el aparato.
  const drafts = state.dayExpenseDrafts.some(sameDay)
    ? state.dayExpenseDrafts
    : [
        ...state.dayExpenseDrafts,
        {
          ref: `GAS-${cie.collectorRef}-${date}`,
          collectorRef: cie.collectorRef,
          collectorName: cie.collectorName,
          date,
          routeRef: cie.routeRef,
          expenses: cie.expenses ?? [],
          expensesTotal: cie.expensesTotal ?? 0,
          updatedAt: cie.closedAt,
        },
      ];
  const plan = planServerSheetClose(
    {
      ...state,
      dayCloses: state.dayCloses.filter((row) => row.ref !== cie.ref && !sameDay(row)),
      planillaCashCloses: (state.planillaCashCloses ?? []).filter(
        (row) => !(sameDay(row) && String(row.routeName).toUpperCase() === "T"),
      ),
      dayExpenseDrafts: drafts,
    },
    { collectorRef: cie.collectorRef, date, route, routeRef: cie.routeRef },
  );
  const stored = cie.cashAdjustment ? cie.cashAdjustment.calculated : cie.cashFloat;
  const label = `${date} ${cie.collectorName.padEnd(10)} ${String(route ?? "-").padEnd(2)}`;
  if (!plan.ok) {
    diffs.push(`${label} servidor no cierra: ${plan.error}`);
    continue;
  }
  const server = plan.record?.cashFloat ?? null;
  const parts = [];
  if (server !== stored) parts.push(`saldo nube ${money(stored)} · servidor ${money(server)} (dif ${money((server ?? 0) - stored)})`);
  if (plan.record && plan.record.collected !== cie.collected) {
    parts.push(`cobrado ${money(cie.collected)} → ${money(plan.record.collected)}`);
  }
  if (plan.record && plan.record.expensesTotal !== cie.expensesTotal) {
    parts.push(`gastos ${money(cie.expensesTotal)} → ${money(plan.record.expensesTotal)}`);
  }
  if (!plan.fullyClosed) parts.push("quedan visitas abiertas");
  if (parts.length) diffs.push(`${label} ${parts.join(" · ")}`);
  else same += 1;
}

console.log(`Cierres revisados desde ${from}: ${cies.length} · iguales ${same} · distintos ${diffs.length}`);
for (const line of diffs) console.log(`  ${line}`);
