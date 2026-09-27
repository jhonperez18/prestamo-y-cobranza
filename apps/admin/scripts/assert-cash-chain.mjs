/**
 * Candado de la regla de inicio (corre en `prebuild`: si falla, NO se publica).
 *
 * Caso real Cristian (COB-0):
 *   - CIE-25 sellado en nube = 2.704.000; cobros en efectivo del 25 = 2.090.000.
 *   - Eslabón local viejo PCE-T-25 = 2.090.000 (la basura que pisaba el Inicial).
 * Exige:
 *   1. Inicial M del 26 = 2.704.000 (CIE de ayer), en planilla e historial.
 *   2. Ninguna proyección (alinear pagos, sintetizar) cambia el saldo sellado.
 *   3. Inicial T = caja viva de M (misma cifra), y saldo final = M + efectivo T.
 *      Historial T · hoy = ese saldo final del libro (ninguna pantalla lo recalcula).
 *   4. Cierre de hoja y auto-cierre 23:30 sellan CIE-26 con el saldo final real,
 *      y ese número es el Inicial M del 27.
 *   5. Cada planilla con lo suyo: préstamo y gasto hechos en T salen de T (no de M),
 *      caja T = Inicial + efectivo − préstamos − gastos, y eso es el Inicial M del 27.
 */
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const { buildDayCashLedger, chainHistorySplit, withLedgerTodaySaldo } = await import(
  "@/lib/day-cash-ledger"
);
const { sealCollectorDay } = await import("@/lib/collector-day-close-seal");
const {
  alignDayClosesCollectedToPayments,
  buildCollectorDayHistory,
  keepSealedCashFloat,
  synthesizeDayClosesFromAssignments,
} = await import("@/lib/collector-day-close");
const {
  annotateMHistoryExtractRows,
  openingCashForChainedPlanilla,
  projectPceTFromDayCloses,
} = await import("@/lib/planilla-cash-chain");
const { runOperationalDayCycle } = await import("@/lib/collector-day-auto-close");

let failures = 0;
function expect(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${label}: ${actual}${ok ? "" : ` (debe ser ${expected})`}`);
}

const COB = { ref: "COB-0", name: "Cristian" };
const Y = "2026-09-25";
const D = "2026-09-26";

const clients = [
  { ref: "CLI-M1", name: "Ana", lastName: "M", route: "M" },
  { ref: "CLI-M2", name: "Beto", lastName: "M", route: "M" },
  { ref: "CLI-T1", name: "Caro", lastName: "T", route: "T" },
  { ref: "CLI-A1", name: "Dani", lastName: "A", route: "A" },
];
const loans = [
  { ref: "P-M1", clientRef: "CLI-M1", client: "Ana M", date: "01/09/2026", capital: 1_000_000, installment: 50_000 },
  { ref: "P-T1", clientRef: "CLI-T1", client: "Caro T", date: "01/09/2026", capital: 500_000, installment: 20_000 },
  { ref: "P-A1", clientRef: "CLI-A1", client: "Dani A", date: "01/09/2026", capital: 500_000, installment: 20_000 },
  // Préstamo nuevo del 26 en efectivo (sale de la caja de M).
  { ref: "P-M2", clientRef: "CLI-M2", client: "Beto M", date: "26/09/2026", capital: 300_000, installment: 15_000, fundedBy: "efectivo" },
];
const pay = (ref, loanRef, amount, paidDate, method = "efectivo") => ({
  ref,
  loanRef,
  amount,
  paidDate,
  method,
  collectorRef: COB.ref,
  collector: COB.name,
});
const payments = [
  pay("PG-Y1", "P-M1", 2_090_000, Y),
  pay("PG-D1", "P-M1", 500_000, D),
  pay("PG-D2", "P-M1", 100_000, D, "nequi"),
  pay("PG-D3", "P-T1", 200_000, D),
  pay("PG-D4", "P-A1", 50_000, D),
];
const visit = (itemId, clientRef, route, date, extra = {}) => ({
  itemId,
  dispatchDate: date,
  loanRef: "",
  clientRef,
  clientName: clientRef,
  clientRoute: route,
  amountDue: 0,
  chargeLabel: "",
  kind: "cuota",
  collectorRef: COB.ref,
  collector: COB.name,
  assignedAt: `${date}T08:00:00.000Z`,
  dispatched: true,
  visitStatus: "cobrado",
  ...extra,
});
const assignments = [
  visit("V-M1", "CLI-M1", "M", D),
  visit("V-T1", "CLI-T1", "T", D),
  visit("V-A1", "CLI-A1", "A", D),
];
const cie25 = {
  ref: `CIE-COB-0-${Y}`,
  collectorRef: COB.ref,
  collectorName: COB.name,
  date: Y,
  routeRef: "",
  collected: 2_090_000,
  expenses: [],
  expensesTotal: 0,
  openingCash: 1_127_000,
  cashExpected: 2_704_000,
  cashDeclared: 2_704_000,
  cashVariance: 0,
  cashFloat: 2_704_000,
  closedAt: `${Y}T23:30:00.000-05:00`,
  movementRefs: [],
};
const stalePceT25 = {
  ref: `PCE-COB-0-${Y}-T`,
  collectorRef: COB.ref,
  collectorName: COB.name,
  date: Y,
  routeName: "T",
  openingCash: 2_090_000,
  closingCash: 2_090_000,
  closedAt: `${Y}T22:00:00.000Z`,
};
const drafts = [
  {
    ref: `GAS-COB-0-${D}`,
    collectorRef: COB.ref,
    collectorName: COB.name,
    date: D,
    routeRef: "",
    expenses: [{ id: "almuerzo", label: "Almuerzo", amount: 20_000, category: "almuerzo" }],
    expensesTotal: 20_000,
    updatedAt: `${D}T12:00:00.000Z`,
  },
];

const base = {
  collectorRef: COB.ref,
  collectorName: COB.name,
  date: D,
  payments,
  loans,
  clients,
  collectors: [COB],
  assignments,
  dayCloses: [cie25],
  dayExpenseDrafts: drafts,
  planillaCashCloses: [stalePceT25],
  monthCloses: [],
};

console.log("— Regla de inicio (caso Cristian) —");

// 1. Inicial M = CIE de ayer, aunque exista PCE-T viejo.
const ledger = buildDayCashLedger(base);
expect("Inicial M 26 = CIE-25", ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : null, 2_704_000);
expect("Caja viva M 26", ledger.mClosing, 2_704_000 + 500_000 - 20_000 - 300_000);
expect("Saldo final 26 (M + efectivo T, sin A ni Nequi)", ledger.dayFinal, 2_884_000 + 200_000);

// 3. Inicial T = caja viva de M.
const tOpen = openingCashForChainedPlanilla({
  collectorRef: COB.ref,
  routeName: "T",
  date: D,
  records: base.planillaCashCloses,
  monthCloses: [],
  dayCloses: base.dayCloses,
  primaryLiveClosing: ledger.mClosing,
});
expect("Inicial T 26 = caja viva M", tOpen.kind === "chain" ? tOpen.opening : null, ledger.mClosing);

// Historial M: Inicial de hoy = CIE de ayer.
const hist = annotateMHistoryExtractRows({
  rows: [
    { date: Y, dateLabel: "25", cobro: 2_090_000, cobroEfectivo: 2_090_000, gasto: 0, prestamo: 0, saldo: 2_090_000 },
    { date: D, dateLabel: "26", cobro: 600_000, cobroEfectivo: 500_000, gasto: 20_000, prestamo: 300_000, saldo: 0 },
  ],
  collectorRef: COB.ref,
  records: base.planillaCashCloses,
  epochBootstrapOpening: 0,
  todayIso: D,
  dayCloses: base.dayCloses,
});
expect("Historial M · 25 saldo", hist.find((r) => r.date === Y)?.saldoShown ?? null, 2_704_000);
expect("Historial M · 26 Inicial", hist.find((r) => r.date === D)?.inicial ?? null, 2_704_000);

// Historial T: la fila de hoy = saldo final del libro (caso real 3.612.000 errado); ayer no se toca.
const histT = withLedgerTodaySaldo(
  [
    { date: Y, dateLabel: "25", saldo: 2_704_000 },
    { date: D, dateLabel: "26", saldo: 3_612_000 },
  ],
  ledger,
);
expect("Historial T · 26 = libro (saldo final)", histT.find((r) => r.date === D)?.saldo ?? null, ledger.dayFinal);
expect("Historial T · 25 intacto", histT.find((r) => r.date === Y)?.saldo ?? null, 2_704_000);

// PCE-T viejo se alinea al CIE.
const projected = projectPceTFromDayCloses(base.planillaCashCloses, base.dayCloses);
expect("PCE-T 25 alineado al CIE", projected.find((r) => r.ref === stalePceT25.ref)?.closingCash ?? null, 2_704_000);

// 2. Proyecciones no tocan el saldo sellado.
const aligned = keepSealedCashFloat(
  base.dayCloses,
  alignDayClosesCollectedToPayments(base.dayCloses, payments, [COB]),
  "alignDayClosesCollectedToPayments",
);
expect("Alinear pagos conserva CIE-25", aligned[0].cashFloat, 2_704_000);
const tampered = [{ ...cie25, cashFloat: 2_090_000 }];
const guarded = keepSealedCashFloat([cie25], tampered, "prueba");
expect("Candado revierte saldo pisado", guarded[0].cashFloat, 2_704_000);

const synthesized = synthesizeDayClosesFromAssignments(
  [visit("V-X", "CLI-M1", "M", "2026-09-24", { dayClosedAt: "2026-09-24T23:30:00.000Z" })],
  payments,
  [],
);
expect("CIE reconstruido queda provisional", synthesized[0]?.provisional === true, true);
const withSynth = openingCashForChainedPlanilla({
  collectorRef: COB.ref,
  routeName: "M",
  date: Y,
  records: [],
  monthCloses: [],
  dayCloses: synthesized,
  fallbackOpening: 1_127_000,
});
expect("Provisional no ancla Inicial", withSynth.kind === "chain" ? withSynth.opening : null, 1_127_000);

// 4a. Cierre de hoja M y luego T (camino del cobrador / panel).
const afterM = sealCollectorDay({
  ...base,
  routeRef: "RUT",
  planillaRoute: "M",
  expensesFallback: [],
  fullyClosed: false,
});
const pceM = afterM.planillaCashCloses.find((r) => r.ref === `PCE-COB-0-${D}-M`);
expect("Cerrar M: PCE-M Inicial", pceM?.openingCash ?? null, 2_704_000);
expect("Cerrar M: PCE-M saldo", pceM?.closingCash ?? null, 2_884_000);
const afterT = sealCollectorDay({
  ...base,
  planillaCashCloses: afterM.planillaCashCloses,
  routeRef: "RUT",
  planillaRoute: "T",
  expensesFallback: [],
  fullyClosed: true,
});
const pceT = afterT.planillaCashCloses.find((r) => r.ref === `PCE-COB-0-${D}-T`);
expect("Cerrar T: Inicial T = saldo M", pceT?.openingCash ?? null, 2_884_000);
expect("Cerrar T: saldo final", pceT?.closingCash ?? null, 3_084_000);
expect("Cerrar T: CIE-26 cash_float", afterT.record?.cashFloat ?? null, 3_084_000);
expect("Cerrar T: CIE-26 Inicial", afterT.record?.openingCash ?? null, 2_704_000);

// 4b. Auto-cierre 23:30 (mismo motor que el cron del servidor).
const cycle = runOperationalDayCycle(
  {
    assignments,
    routes: [],
    logs: [],
    dayCloses: [cie25],
    dayExpenseDrafts: drafts,
    payments,
    loans,
    clients,
    collectors: [COB],
    planillaCashCloses: [stalePceT25],
    monthCloses: [],
  },
  new Date("2026-09-27T05:10:00.000Z"),
);
const cie26 = cycle.dayCloses.find((r) => r.ref === `CIE-COB-0-${D}`);
expect("Auto-cierre: CIE-26 cash_float", cie26?.cashFloat ?? null, 3_084_000);
expect("Auto-cierre: CIE-25 intacto", cycle.dayCloses.find((r) => r.ref === cie25.ref)?.cashFloat ?? null, 2_704_000);
const next = openingCashForChainedPlanilla({
  collectorRef: COB.ref,
  routeName: "M",
  date: "2026-09-27",
  records: cycle.planillaCashCloses,
  monthCloses: [],
  dayCloses: cycle.dayCloses,
});
expect("Inicial M 27 = CIE-26", next.kind === "chain" ? next.opening : null, 3_084_000);

// 5. Cada planilla con lo suyo: préstamo + gasto hechos en T salen de T, no de M (y al revés).
console.log("— Préstamo y gasto propios de T —");
const clientT2 = { ref: "CLI-T2", name: "Eva", lastName: "T", route: "T" };
const loanT2 = { ref: "P-T2", clientRef: "CLI-T2", client: "Eva T", date: "26/09/2026", capital: 100_000, installment: 5_000, fundedBy: "efectivo" };
const draftsT = [
  {
    ...drafts[0],
    expenses: [
      ...drafts[0].expenses,
      { id: "gasolina", label: "Gasolina", amount: 10_000, category: "gasolina", route: "T" },
    ],
    expensesTotal: 30_000,
  },
];
const baseT = {
  ...base,
  clients: [...clients, clientT2],
  loans: [...loans, loanT2],
  dayExpenseDrafts: draftsT,
};
const ledgerT = buildDayCashLedger(baseT);
expect("M · préstamos (sin el de T)", ledgerT.m.prestamos, 300_000);
expect("M · gastos (sin el de T)", ledgerT.m.gastos, 20_000);
expect("M · no lista el préstamo de T", ledgerT.m.loanRows.some((r) => r.loanRef === "P-T2"), false);
expect("Caja viva M intacta", ledgerT.mClosing, 2_884_000);
expect("T · préstamos propios", ledgerT.t.prestamos, 100_000);
expect("T · gastos propios", ledgerT.t.gastos, 10_000);
expect("T · no lista el préstamo de M", ledgerT.t.loanRows.some((r) => r.loanRef === "P-M2"), false);
expect("Caja T = Inicial + efectivo − préstamos − gastos", ledgerT.dayFinal, 2_884_000 + 200_000 - 100_000 - 10_000);

const splitArgs = (side) => ({
  assignments,
  loans: baseT.loans,
  clients: baseT.clients,
  chainSplit: chainHistorySplit(side, COB.ref, baseT.clients, assignments),
});
const histMRow = buildCollectorDayHistory(COB.ref, payments, [cie25], [COB], [D], draftsT, [], undefined, splitArgs("primary")).find((r) => r.date === D);
const histTRow = buildCollectorDayHistory(COB.ref, payments, [cie25], [COB], [D], draftsT, [], undefined, splitArgs("secondary")).find((r) => r.date === D);
expect("Historial M · 26 préstamo", histMRow?.prestamo ?? null, 300_000);
expect("Historial M · 26 gasto", histMRow?.gasto ?? null, 20_000);
expect("Historial T · 26 préstamo", histTRow?.prestamo ?? null, 100_000);
expect("Historial T · 26 gasto", histTRow?.gasto ?? null, 10_000);

const tAfterM = sealCollectorDay({ ...baseT, routeRef: "RUT", planillaRoute: "M", expensesFallback: [], fullyClosed: false });
const tAfterT = sealCollectorDay({
  ...baseT,
  planillaCashCloses: tAfterM.planillaCashCloses,
  routeRef: "RUT",
  planillaRoute: "T",
  expensesFallback: [],
  fullyClosed: true,
});
expect("Cerrar T: PCE-T Inicial = caja M", tAfterT.planillaCashCloses.find((r) => r.ref === `PCE-COB-0-${D}-T`)?.openingCash ?? null, 2_884_000);
expect("Cerrar T: CIE-26 cash_float", tAfterT.record?.cashFloat ?? null, 2_974_000);
const tNext = openingCashForChainedPlanilla({
  collectorRef: COB.ref,
  routeName: "M",
  date: "2026-09-27",
  records: tAfterT.planillaCashCloses,
  monthCloses: [],
  dayCloses: tAfterT.dayCloses,
});
expect("Inicial M 27 = caja T del 26", tNext.kind === "chain" ? tNext.opening : null, 2_974_000);

if (failures) {
  console.error(`\n✖ Regla de inicio ROTA (${failures} falla${failures === 1 ? "" : "s"}). No se publica.`);
  process.exit(1);
}
console.log("\n✔ Regla de inicio intacta.");
