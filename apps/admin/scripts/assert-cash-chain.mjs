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
 *   6. Pago tardío: la plata entra hoy (caja sube), cubre la cuota del día cerrado,
 *      la visita de hoy sigue por cobrar y el CIE del día cubierto no cambia.
 *   7. Ajuste de saldo real en T: solo con T cerrada y el mismo día; el real pasa a
 *      CIE/PCE-T y es el Inicial M de mañana; el saldo del cierre queda en el Historial.
 *   8. Cartera existente (carga desde planilla manual): no descuenta caja M ni T.
 *   9. Cobro del panel: «Solo sistema» no toca la caja; «Cobrador» en efectivo sí, y nunca a caja cerrada.
 *  10. Modificar préstamo: el gasto «Préstamo» del cobrador sigue al capital (día abierto).
 *  11. Saldo propio de A y N: ajuste tras cerrar = Inicial de esa planilla mañana; M→T intacta.
 *      N: el CIE sella la caja del historial (Inicial + movimiento), no el neto del día.
 *  29. Banco / Nequi de la ruta = historial de esa ruta (cobros, cobrador + oficina).
 *      T / M / N → Banco; A → solo Nequi. Lo que entra al botón es lo que entra
 *      a ese historial. No toca la caja.
 */
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const { buildDayCashLedger, chainDayCuadre, chainHistorySplit, isChainCollectorDay, primaryClosingForDay, withLedgerTodaySaldo } = await import(
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
  primaryClosingFor: (dateIso) => primaryClosingForDay(base, dateIso),
});
expect("Historial M · 25 saldo (sin T ese día = CIE)", hist.find((r) => r.date === Y)?.saldoShown ?? null, 2_704_000);
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

// Cierre del día (supervisor): M = la mañana; T = día entero M+T, misma Caja que el libro.
const sumLines = (lines, loan) =>
  lines.filter((l) => (l.category === "prestamo_ruta") === loan).reduce((s, l) => s + l.amount, 0);
const cuadreM = chainDayCuadre(baseT, "primary");
const cuadreT = chainDayCuadre(baseT, "secondary");
expect("Cierre M · Inicial = CIE de ayer", cuadreM.opening, 2_704_000);
expect("Cierre T · Inicial = caja final de M (no el Inicial de M)", cuadreT.opening, ledgerT.mClosing);
expect(
  "Cierre T · Inicial T + efectivo T − préstamos T − gastos T = Caja",
  cuadreT.opening + cuadreT.ownEfectivo - cuadreT.ownPrestamos - cuadreT.ownGastos,
  ledgerT.dayFinal,
);
expect("Cierre M · efectivo solo M", cuadreM.efectivo, ledgerT.m.efectivo);
expect("Cierre M · préstamos solo M", sumLines(cuadreM.lines, true), 300_000);
expect("Cierre M · Caja = Inicial de T", cuadreM.closing, ledgerT.mClosing);
expect("Cierre T · efectivo M+T", cuadreT.efectivo, ledgerT.m.efectivo + ledgerT.t.efectivo);
expect("Cierre T · efectivo solo T", cuadreT.ownEfectivo, ledgerT.t.efectivo);
expect("Cierre T · solo T + M = total", cuadreT.ownEfectivo + cuadreM.ownEfectivo, cuadreT.efectivo);
expect("Cierre T · préstamos M+T", sumLines(cuadreT.lines, true), 400_000);
expect("Cierre T · préstamos solo T", cuadreT.ownPrestamos, 100_000);
expect(
  "Cierre T · lista de préstamos solo T (suma = préstamos T)",
  cuadreT.ownLoanLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
  cuadreT.ownPrestamos,
);
expect("Cierre T · gastos solo T", cuadreT.ownGastos, 10_000);
expect(
  "Cierre T · lista de gastos solo T (suma = gastos T)",
  cuadreT.ownGastoLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
  cuadreT.ownGastos,
);
expect("Cierre M · gastos solo M", cuadreM.ownGastos, 20_000);
expect("Cierre T · préstamos solo T + M = M+T", cuadreT.ownPrestamos + cuadreM.ownPrestamos, 400_000);
expect("Cierre T · gastos M+T", sumLines(cuadreT.lines, false), 30_000);
expect("Cierre T · Caja = saldo final del día", cuadreT.closing, ledgerT.dayFinal);
{
  // Día ya sellado (caso 01/10: CIE 12.271.000, M cerró en 12.954.000).
  const sealedD = (cashFloat) => ({
    ...baseT,
    dayCloses: [...baseT.dayCloses, { ...cie25, ref: `CIE-COB-0-${D}`, date: D, cashFloat, cashExpected: cashFloat }],
  });
  const sealedLedger = buildDayCashLedger(sealedD(0));
  const tDelta = sealedLedger.dayFinal - sealedLedger.mClosing;
  const exact = sealedD(sealedLedger.dayFinal);
  expect("Historial M · ayer = caja final de M (no el CIE)", primaryClosingForDay(exact, D), sealedLedger.mClosing);
  expect("Cierre M · Caja = caja final de M (no el CIE)", chainDayCuadre(exact, "primary").closing, sealedLedger.mClosing);
  expect("Caja final de M ≠ saldo final del día cuando T movió plata", sealedLedger.mClosing !== sealedLedger.dayFinal, true);
  const off = sealedD(sealedLedger.dayFinal + 100_000);
  expect("CIE manda: caja final de M = CIE − movimiento de T", primaryClosingForDay(off, D), sealedLedger.dayFinal + 100_000 - tDelta);
  expect(
    "Cierre T · Inicial T = Caja de M (misma cifra)",
    chainDayCuadre(off, "secondary").opening,
    chainDayCuadre(off, "primary").closing,
  );
  expect("Cierre T · Caja de un día cerrado = CIE (saldo final, Inicial M mañana)", chainDayCuadre(off, "secondary").closing, sealedLedger.dayFinal + 100_000);
  const { withSealedDaySaldos } = await import("@/lib/day-cash-ledger");
  const tomorrow = "2026-09-27";
  const histTSealed = withSealedDaySaldos(
    [
      { date: D, saldo: primaryClosingForDay(off, D) },
      { date: tomorrow, saldo: 1 },
    ],
    COB.ref,
    off.dayCloses,
    tomorrow,
  );
  expect("Historial T · ayer = CIE (no caja de M + movimiento T)", histTSealed[0].saldo, sealedLedger.dayFinal + 100_000);
  expect("Historial T · hoy no lo toca (lo pone el libro)", histTSealed[1].saldo, 1);
}
expect(
  "Cierre T · Banco T + Banco M = Banco M+T",
  cuadreT.ownDigital + cuadreM.ownDigital,
  cuadreT.nequi + cuadreT.banco,
);
expect(
  "Cierre T · lista Banco T suma el botón Banco T",
  cuadreT.ownDigitalPayments.reduce((sum, p) => sum + p.amount, 0),
  cuadreT.ownDigital,
);
expect(
  "Cierre M · lista Banco suma su botón",
  cuadreM.ownDigitalPayments.reduce((sum, p) => sum + p.amount, 0),
  cuadreM.ownDigital,
);
expect("Cierre M · botón Banco = lista Banco de M", cuadreM.banco + cuadreM.nequi, cuadreM.ownDigital);
expect(
  "Cierre T · Inicial M + efectivo M+T − préstamos M+T − gastos M+T = Caja",
  cuadreM.opening + cuadreT.efectivo - sumLines(cuadreT.lines, true) - sumLines(cuadreT.lines, false),
  cuadreT.closing,
);

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

// 6. Pago tardío (panel): cuota del 25 olvidada. La plata entra el 26; el 25 no se reabre.
console.log("— Pago tardío —");
const { commitLatePayment } = await import("@/lib/commit-late-payment");
const { encodeLateChargeLabel, parseLateChargeLabel } = await import("@/lib/late-payment");
const { liveLoanCollectionAlerts } = await import("@/lib/collection-alerts");
const { reconcilePaymentsOntoPlanilla } = await import("@/lib/planilla-payment-reconcile");

const clientL = { ref: "CLI-M3", name: "Fito", lastName: "M", route: "M", pending: 60_000 };
const scheduleL = [
  { date: Y, amount: 20_000, kind: "cuota", paid: 0 },
  { date: D, amount: 20_000, kind: "cuota", paid: 0 },
  { date: "2026-09-28", amount: 20_000, kind: "cuota", paid: 0 },
];
const loanL = {
  ref: "P-L1",
  clientRef: "CLI-M3",
  client: "Fito M",
  date: "24/09/2026",
  capital: 60_000,
  total: 60_000,
  paid: 0,
  balance: 60_000,
  installment: 20_000,
  status: "Activo",
  kind: "pending",
  schedule: scheduleL,
};
const lateVisitY = visit("V-L-Y", "CLI-M3", "M", Y, {
  loanRef: "P-L1",
  visitStatus: "omitido",
  amountDue: 20_000,
  dayClosedAt: `${Y}T23:30:00.000-05:00`,
});
const lateVisitD = visit("V-L-D", "CLI-M3", "M", D, {
  loanRef: "P-L1",
  visitStatus: "pendiente",
  amountDue: 20_000,
});
const lateBase = {
  ...base,
  clients: [...clients, clientL],
  loans: [...loans, loanL],
  assignments: [...assignments, lateVisitY, lateVisitD],
};
const lateNow = new Date("2026-09-26T15:00:00.000-05:00");
const late = commitLatePayment({
  loanRef: "P-L1",
  coversDate: Y,
  amount: 20_000,
  method: "efectivo",
  reason: "Lo recibió y no lo anotó",
  registeredBy: "Admin",
  payments: lateBase.payments,
  loans: lateBase.loans,
  clients: lateBase.clients,
  assignments: lateBase.assignments,
  collectors: [COB],
  dayCloses: [cie25],
  now: lateNow,
});
expect("Pago tardío: se registra", late.ok, true);
if (late.ok) {
  expect("Pago tardío: la plata entra el 26", late.payment.paidDate, D);
  expect("Pago tardío: cubre la cuota del 25", late.payment.lateFor?.date ?? null, Y);
  expect("Pago tardío: caja del cobrador de la ruta", late.payment.collectorRef, COB.ref);
  const visitD = late.assignments.find((r) => r.itemId === "V-L-D");
  expect("Pago tardío: visita de hoy sigue por cobrar", visitD?.visitStatus ?? null, "pendiente");
  const visitY = late.assignments.find((r) => r.itemId === "V-L-Y");
  expect("Pago tardío: planilla del 25 sellada intacta", visitY?.visitStatus ?? null, "omitido");
  const repull = reconcilePaymentsOntoPlanilla(late.assignments, late.payments, late.loans);
  expect("Pago tardío: un pull no marca la visita de hoy", repull.find((r) => r.itemId === "V-L-D")?.visitStatus ?? null, "pendiente");
  const loanAfter = late.loans.find((r) => r.ref === "P-L1");
  expect("Pago tardío: cuota del 25 pagada", loanAfter?.schedule?.find((l) => l.date === Y)?.paid ?? null, 20_000);
  expect("Pago tardío: cuota del 26 abierta", loanAfter?.schedule?.find((l) => l.date === D)?.paid ?? 0, 0);
  expect("Pago tardío: sin alerta hoy", liveLoanCollectionAlerts(loanAfter, late.payments, D), 0);
  expect("Pago tardío: si no paga el 26, el lunes 28 = Alerta 1", liveLoanCollectionAlerts(loanAfter, late.payments, "2026-09-28"), 1);

  const ledgerBefore = buildDayCashLedger(lateBase);
  const ledgerAfter = buildDayCashLedger({
    ...lateBase,
    payments: late.payments,
    loans: late.loans,
    clients: late.clients,
    assignments: late.assignments,
  });
  expect("Pago tardío: caja M de hoy sube el monto", ledgerAfter.mClosing - ledgerBefore.mClosing, 20_000);
  const alignedLate = keepSealedCashFloat(
    [cie25],
    alignDayClosesCollectedToPayments([cie25], late.payments, [COB]),
    "pago-tardio",
  );
  expect("Pago tardío: CIE-25 recaudo intacto", alignedLate[0].collected, 2_090_000);
  expect("Pago tardío: CIE-25 saldo intacto", alignedLate[0].cashFloat, 2_704_000);

  const again = commitLatePayment({
    loanRef: "P-L1",
    coversDate: Y,
    amount: 20_000,
    method: "efectivo",
    reason: "doble",
    registeredBy: "Admin",
    payments: late.payments,
    loans: late.loans,
    clients: late.clients,
    assignments: late.assignments,
    collectors: [COB],
    dayCloses: [cie25],
    now: lateNow,
  });
  expect("Pago tardío: no se duplica el mismo día", again.ok, false);

  const label = encodeLateChargeLabel("Cuota", late.payment.lateFor);
  const parsed = parseLateChargeLabel(label);
  expect("Pago tardío: marca viaja a la nube (fecha)", parsed.lateFor?.date ?? null, Y);
  expect("Pago tardío: marca viaja a la nube (motivo)", parsed.lateFor?.reason ?? null, "Lo recibió y no lo anotó");
  expect("Pago tardío: concepto intacto", parsed.chargeLabel ?? null, "Cuota");
}

// 7. Ajuste de saldo real en T (supervisor): tras cerrar T, el mismo día.
console.log("— Ajuste de saldo real en T —");
const { commitCashAdjustment, cashAdjustmentWindow } = await import("@/lib/commit-cash-adjustment");
const { attachCashAdjustments, joinCashAdjustmentRefs, splitCashAdjustmentRefs } = await import(
  "@/lib/cash-adjustment"
);
const { alignChainLinksToLedger } = await import("@/lib/day-cash-ledger");

const adjNow = new Date("2026-09-26T20:00:00.000-05:00");
const cieRef26 = `CIE-COB-0-${D}`;
const pceTRef26 = `PCE-COB-0-${D}-T`;
expect("Ajuste: sin cierre de T no se puede", cashAdjustmentWindow(COB.ref, [cie25], adjNow).open, false);
expect("Ajuste: día siguiente ya no se puede", cashAdjustmentWindow(COB.ref, afterT.dayCloses, new Date("2026-09-27T09:00:00.000-05:00")).open, false);
const adj = commitCashAdjustment({
  collectorRef: COB.ref,
  real: 2_934_000,
  reason: "Conteo real de caja",
  by: "Supervisor",
  dayCloses: afterT.dayCloses,
  planillaCashCloses: afterT.planillaCashCloses,
  now: adjNow,
});
expect("Ajuste: se registra", adj.ok, true);
if (adj.ok) {
  expect("Ajuste: CIE-26 cash_float = real", adj.record.cashFloat, 2_934_000);
  expect("Ajuste: saldo del cierre conservado", adj.record.cashAdjustment?.calculated ?? null, 3_084_000);
  expect("Ajuste: CIE-25 intacto", adj.dayCloses.find((r) => r.ref === cie25.ref)?.cashFloat ?? null, 2_704_000);
  const adjPceT = adj.planillaCashCloses.find((r) => r.ref === pceTRef26);
  expect("Ajuste: PCE-T 26 saldo = real", adjPceT?.closingCash ?? null, 2_934_000);
  expect("Ajuste: PCE-T 26 Inicial intacto", adjPceT?.openingCash ?? null, 2_884_000);
  const adjNext = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: "2026-09-27",
    records: adj.planillaCashCloses,
    monthCloses: [],
    dayCloses: adj.dayCloses,
  });
  expect("Ajuste: Inicial M 27 = saldo real", adjNext.kind === "chain" ? adjNext.opening : null, 2_934_000);

  const adjLedger = buildDayCashLedger({ ...base, dayCloses: adj.dayCloses, planillaCashCloses: adj.planillaCashCloses });
  const realigned = alignChainLinksToLedger(adj.planillaCashCloses, adjLedger);
  expect("Ajuste: libro no rebobina PCE-T", realigned.find((r) => r.ref === pceTRef26)?.closingCash ?? null, 2_934_000);

  const again = commitCashAdjustment({
    collectorRef: COB.ref,
    real: 2_900_000,
    reason: "Recontado",
    by: "Admin",
    dayCloses: adj.dayCloses,
    planillaCashCloses: adj.planillaCashCloses,
    now: new Date("2026-09-26T21:00:00.000-05:00"),
  });
  expect("Ajuste: re-editar corrige el mismo renglón", again.ok ? again.dayCloses.filter((r) => r.ref === cieRef26).length : null, 1);
  expect("Ajuste: re-editar conserva saldo del cierre", again.ok ? again.record.cashAdjustment?.calculated ?? null : null, 3_084_000);
  expect("Ajuste: re-editar nuevo real", again.ok ? again.record.cashFloat : null, 2_900_000);

  const guardedAdj = keepSealedCashFloat(
    adj.dayCloses,
    alignDayClosesCollectedToPayments(adj.dayCloses, payments, [COB]),
    "ajuste",
  );
  expect("Ajuste: proyecciones conservan el real", guardedAdj.find((r) => r.ref === cieRef26)?.cashFloat ?? null, 2_934_000);

  const adjCycle = runOperationalDayCycle(
    {
      assignments: afterT.assignments ?? assignments,
      routes: [],
      logs: [],
      dayCloses: adj.dayCloses,
      dayExpenseDrafts: drafts,
      payments,
      loans,
      clients,
      collectors: [COB],
      planillaCashCloses: adj.planillaCashCloses,
      monthCloses: [],
    },
    new Date("2026-09-27T05:10:00.000Z"),
  );
  expect("Ajuste: auto-cierre 23:30 no lo pisa", adjCycle.dayCloses.find((r) => r.ref === cieRef26)?.cashFloat ?? null, 2_934_000);

  const refs = joinCashAdjustmentRefs(["MOV-1"], adj.record.cashAdjustment);
  const back = splitCashAdjustmentRefs(refs);
  expect("Ajuste: viaja a la nube (real)", back.cashAdjustment?.real ?? null, 2_934_000);
  expect("Ajuste: viaja a la nube (motivo)", back.cashAdjustment?.reason ?? null, "Conteo real de caja");
  expect("Ajuste: refs de movimientos intactas", back.movementRefs.join(","), "MOV-1");

  const histAdj = attachCashAdjustments(
    [{ date: D, dateLabel: "26", saldo: adjLedger.dayFinal }],
    COB.ref,
    adj.dayCloses,
  );
  expect("Historial T · 26 renglón del cierre", histAdj[0].row.saldo, 3_084_000);
  expect("Historial T · 26 renglón de ajuste", histAdj[0].adjustment?.real ?? null, 2_934_000);
}

// 8. Cartera existente: préstamos cargados desde planilla manual. Ya estaban en la calle:
//    no salen de la caja de M ni de T, ni figuran como «Prestado» en la planilla del día.
console.log("— Cartera existente —");
const { buildCollectorHistoryPlanillaRows } = await import("@/lib/collector-history-planilla");
const { loanRowToMirror, mirrorToLoanRow } = await import("@/lib/supabase/catalog-mirror");
const { markLoanExistingPortfolio } = await import("@/lib/nequi-pool");

const carteraT = markLoanExistingPortfolio({
  ref: "P-CT1", clientRef: "CLI-T1", client: "Caro T", date: "26/09/2026", capital: 800_000, installment: 40_000,
});
const carteraM = markLoanExistingPortfolio({
  ref: "P-CM1", clientRef: "CLI-M1", client: "Ana M", date: "26/09/2026", capital: 600_000, installment: 30_000,
});
const ledgerSinCartera = buildDayCashLedger(base);
const ledgerCartera = buildDayCashLedger({ ...base, loans: [...loans, carteraT, carteraM] });
expect("Cartera: préstamos de M no cambian", ledgerCartera.m.prestamos, ledgerSinCartera.m.prestamos);
expect("Cartera: préstamos de T no cambian", ledgerCartera.t.prestamos, ledgerSinCartera.t.prestamos);
expect("Cartera: caja viva M intacta", ledgerCartera.mClosing, ledgerSinCartera.mClosing);
expect("Cartera: saldo final del día intacto", ledgerCartera.dayFinal, ledgerSinCartera.dayFinal);
const efectivoT = { ref: "P-ET1", clientRef: "CLI-T1", client: "Caro T", date: "26/09/2026", capital: 50_000, installment: 5_000, fundedBy: "efectivo" };
const planillaCartera = buildCollectorHistoryPlanillaRows({
  dateIso: D,
  dispatched: assignments,
  payments: [],
  loans: [...loans, carteraT, carteraM, efectivoT],
  clients,
});
expect(
  "Cartera: sin fila «Prestado» en la planilla",
  planillaCartera.some((r) => r.key === "prestamo:P-CT1" || r.key === "prestamo:P-CM1"),
  false,
);
expect("Efectivo del día sí figura «Prestado»", planillaCartera.some((r) => r.key === "prestamo:P-ET1"), true);
const planillaMetodo = buildCollectorHistoryPlanillaRows({
  dateIso: D,
  dispatched: [],
  payments: [
    { ...pay("PG-NT", "P-T1", 20_000, D, "nequi"), when: "26/09/2026 · 10:00" },
    { ...pay("PG-BA", "P-A1", 20_000, D, "banco"), when: "26/09/2026 · 10:05" },
  ],
  loans,
  clients,
});
const metodoDe = (clientRef) => planillaMetodo.find((r) => r.clientRef === clientRef)?.method ?? null;
expect("Planilla: no efectivo de T se ve «Banco»", metodoDe("CLI-T1"), "banco");
expect("Planilla: no efectivo de A se ve «Nequi»", metodoDe("CLI-A1"), "nequi");
const carteraBack = mirrorToLoanRow(loanRowToMirror(carteraT));
expect("Cartera: la marca viaja a la nube", carteraBack?.fundedBy ?? null, "cartera");

// 9. Pagar cuota / Abono desde el panel: «Solo sistema» no toca al cobrador;
//    «Cobrador de la ruta» en efectivo entra a su caja de hoy (lado de la ruta del cliente).
console.log("— Cobro del panel con destino —");
const { routeCollectorCashTarget } = await import("@/lib/route-collector-cash");
const panelNow = new Date("2026-09-26T15:00:00.000-05:00");
const panelTarget = routeCollectorCashTarget({
  loan: { ref: "P-T1", clientRef: "CLI-T1" },
  clients,
  routes: [],
  collectors: [COB],
  assignments,
  dayCloses: [cie25],
  date: D,
  now: panelNow,
});
expect("Panel: cobrador de la ruta del cliente", panelTarget.ok ? panelTarget.collector.ref : null, COB.ref);
const panelClosed = routeCollectorCashTarget({
  loan: { ref: "P-T1", clientRef: "CLI-T1" },
  clients,
  routes: [],
  collectors: [COB],
  assignments,
  dayCloses: afterT.dayCloses,
  date: D,
  now: panelNow,
});
expect("Panel: caja ya cerrada no recibe", panelClosed.ok, false);
const panelPay = (extra) => ({ ref: "PG-PANEL", loanRef: "P-T1", amount: 30_000, paidDate: D, source: "caja", ...extra });
const ledgerOficina = buildDayCashLedger({
  ...base,
  payments: [...payments, panelPay({ method: "efectivo", collector: "Caja / oficina" })],
});
const ledgerCobrador = buildDayCashLedger({
  ...base,
  payments: [...payments, panelPay({ method: "efectivo", collector: COB.name, collectorRef: COB.ref })],
});
const ledgerNequiRuta = buildDayCashLedger({
  ...base,
  payments: [...payments, panelPay({ method: "nequi", collector: COB.name, collectorRef: COB.ref })],
});
expect("Panel · solo sistema: caja intacta", ledgerOficina.dayFinal, ledgerSinCartera.dayFinal);
expect("Panel · cobrador efectivo: suma a su caja", ledgerCobrador.dayFinal - ledgerSinCartera.dayFinal, 30_000);
expect("Panel · cobrador efectivo: va al lado T (cliente de T)", ledgerCobrador.mClosing, ledgerSinCartera.mClosing);
expect("Panel · cobrador Nequi: no entra a la caja", ledgerNequiRuta.dayFinal, ledgerSinCartera.dayFinal);

// 10. Modificar préstamo: la línea «Préstamo» del GAS- sigue al capital nuevo (efectivo);
//     otro origen la saca; un día con CIE- sellado no se toca.
console.log("— Modificar préstamo → gasto del cobrador —");
const { syncCashDisbursementExpense } = await import("@/lib/collector-day-close");
const gasLoan = {
  ...drafts[0],
  expenses: [
    ...drafts[0].expenses,
    { id: "prestamo", label: "Préstamo · P-M2 · Beto M", amount: 1_000, category: "prestamo_ruta", loanRef: "P-M2" },
  ],
  expensesTotal: 21_000,
};
const fixedLoan = { ...loans[3], capital: 300_000, fundedBy: "efectivo" };
const synced = syncCashDisbursementExpense([gasLoan], [cie25], fixedLoan);
const syncedLine = synced.drafts[0].expenses.find((r) => r.loanRef === "P-M2");
expect("Editar préstamo: línea del gasto = capital nuevo", syncedLine?.amount ?? null, 300_000);
expect("Editar préstamo: gasto operativo intacto", synced.drafts[0].expenses.find((r) => r.id === "almuerzo")?.amount ?? null, 20_000);
expect("Editar préstamo: total del GAS- recalculado", synced.drafts[0].expensesTotal, 320_000);
const ledgerEdit = buildDayCashLedger({ ...base, dayExpenseDrafts: synced.drafts });
expect("Editar préstamo: KPI préstamo M = capital nuevo", ledgerEdit.m.prestamos, 300_000);
const toNequi = syncCashDisbursementExpense([gasLoan], [cie25], { ...fixedLoan, fundedBy: "nequi" });
expect("Editar préstamo: pasa a Nequi → sale de la caja", toNequi.drafts[0].expenses.some((r) => r.loanRef === "P-M2"), false);
const sealedDay = syncCashDisbursementExpense([gasLoan], [{ ...cie25, ref: `CIE-COB-0-${D}`, date: D }], fixedLoan);
expect("Editar préstamo: día con CIE sellado no se toca", sealedDay.changed.length, 0);

// 11. Saldo propio de A y N: ajuste tras cerrar la planilla (mismo día); el real es el
//     Inicial de esa planilla mañana. La cadena M→T (CIE cash_float, ajuste T, PCE) no se toca.
console.log("— Saldo propio A / N —");
const {
  commitRouteCashAdjustment,
  independentRouteCollected,
  independentRouteDay,
  independentRouteDayLines,
  routeCashAdjustmentWindow,
  withIndependentRouteHistory,
} = await import("@/lib/independent-route-cash");
const { mergeRouteCashAdjustments } = await import("@/lib/cash-adjustment");
const cieAfterT26 = afterT.dayCloses.find((r) => r.ref === cieRef26);
expect("A/N: sin cierre no se puede", routeCashAdjustmentWindow(COB.ref, "A", [cie25], adjNow).open, false);
expect("A/N: M no usa este ajuste", routeCashAdjustmentWindow(COB.ref, "M", afterT.dayCloses, adjNow).open, false);
expect("A/N: con la planilla cerrada se puede", routeCashAdjustmentWindow(COB.ref, "A", afterT.dayCloses, adjNow).open, true);
const aDay26 = independentRouteDay({ ...base, dayCloses: afterT.dayCloses }, "A");
expect("A 26: sin ajuste previo, Inicial de siempre (0)", aDay26.opening, 0);
expect("A 26: caja = efectivo de A (préstamos/gastos van a M)", aDay26.closing, 50_000);
// A no reporta nada de M / T: solo comparte el cobrador.
const aCollected26 = independentRouteCollected({ ...base, dayCloses: afterT.dayCloses }, "A");
expect("A aislada: efectivo del día = solo clientes de A", aCollected26.efectivo, 50_000);
expect("A aislada: día sin gastos ni préstamos de M/T", independentRouteDayLines(aDay26).length, 0);
const [aHist26] = withIndependentRouteHistory(
  [{ date: D, cobro: 50_000, gasto: 999_999, prestamo: 999_999, saldo: 3_084_000 }],
  { ...base, dayCloses: afterT.dayCloses },
  "A",
);
expect("A aislada: Historial sin gasto de M/T", aHist26.gasto, 0);
expect("A aislada: Historial sin préstamo de M/T", aHist26.prestamo, 0);
expect("A aislada: Historial con saldo propio (no el de la cadena)", aHist26.saldo, 50_000);
// Préstamo a cliente de A: antes del 30/09 salía de M; desde el 30/09 sale de la caja de A.
const loanA26 = { ref: "P-A3", clientRef: "CLI-A1", client: "Dani A", date: "26/09/2026", capital: 150_000, installment: 7_500, fundedBy: "efectivo" };
const mBeforeCut = buildDayCashLedger({ ...base, loans: [...loans, loanA26] }).m;
expect("A antes del 30/09: su préstamo seguía en M (días sellados intactos)", mBeforeCut.loanRows.some((r) => r.loanRef === "P-A3"), true);
const O = "2026-09-30";
const ownSrc = {
  ...base,
  date: O,
  loans: [
    ...loans,
    { ref: "P-A2", clientRef: "CLI-A1", client: "Dani A", date: "30/09/2026", capital: 200_000, installment: 10_000, fundedBy: "efectivo" },
    { ref: "P-M3", clientRef: "CLI-M2", client: "Beto M", date: "30/09/2026", capital: 100_000, installment: 5_000, fundedBy: "efectivo" },
  ],
  payments: [...payments, pay("PG-O1", "P-A1", 60_000, O)],
  assignments: [
    ...assignments,
    visit("V-M2-O", "CLI-M2", "M", O),
    visit("V-T1-O", "CLI-T1", "T", O),
    visit("V-A1-O", "CLI-A1", "A", O),
  ],
  dayExpenseDrafts: [],
};
const ownLedger = buildDayCashLedger(ownSrc);
expect("A desde 30/09: M no descuenta el préstamo de A", ownLedger.m.loanRows.map((r) => r.loanRef).join(","), "P-M3");
expect("A desde 30/09: T tampoco", ownLedger.t.loanRows.length, 0);
const aOwn = independentRouteDay(ownSrc, "A");
expect("A desde 30/09: su caja descuenta su préstamo", aOwn.prestamos, 200_000);
expect("A desde 30/09: caja A = efectivo A − préstamo A", aOwn.closing, 60_000 - 200_000);
expect("A desde 30/09: sin gastos de M/T", aOwn.gastos, 0);
const aAdj = commitRouteCashAdjustment({
  collectorRef: COB.ref,
  route: "A",
  real: 80_000,
  reason: "Conteo real A",
  by: "Supervisor",
  calculated: aDay26.closing,
  dayCloses: afterT.dayCloses,
  now: adjNow,
});
expect("A/N: se registra", aAdj.ok, true);
if (aAdj.ok) {
  expect("A/N: CIE cash_float intacto (cadena)", aAdj.record.cashFloat, cieAfterT26?.cashFloat ?? null);
  expect("A/N: ajuste de T intacto", aAdj.record.cashAdjustment ?? null, cieAfterT26?.cashAdjustment ?? null);
  const pay27 = pay("PG-E1", "P-A1", 30_000, "2026-09-27");
  const aDay27 = independentRouteDay(
    { ...base, date: "2026-09-27", dayCloses: aAdj.dayCloses, payments: [...payments, pay27] },
    "A",
  );
  expect("A 27: Inicial = saldo real del 26", aDay27.opening, 80_000);
  expect("A 27: caja = real + efectivo de A", aDay27.closing, 110_000);
  const aDay28 = independentRouteDay(
    { ...base, date: "2026-09-28", dayCloses: aAdj.dayCloses, payments: [...payments, pay27] },
    "A",
  );
  expect("A 28: arrastre del 27", aDay28.opening, 110_000);
  const mNext = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: "2026-09-27",
    records: afterT.planillaCashCloses,
    monthCloses: [],
    dayCloses: aAdj.dayCloses,
  });
  expect("A/N: Inicial M 27 sigue siendo el CIE-26", mNext.kind === "chain" ? mNext.opening : null, 3_084_000);
  const again = commitRouteCashAdjustment({
    collectorRef: COB.ref,
    route: "A",
    real: 75_000,
    reason: "Recontado A",
    by: "Admin",
    calculated: 999,
    dayCloses: aAdj.dayCloses,
    now: new Date("2026-09-26T21:00:00.000-05:00"),
  });
  expect("A/N: re-editar conserva el calculado", again.ok ? again.record.routeCashAdjustments?.[0]?.calculated ?? null : null, 50_000);
  expect("A/N: re-editar un solo ajuste por ruta", again.ok ? again.record.routeCashAdjustments?.length ?? null : null, 1);
  const refsA = joinCashAdjustmentRefs(["MOV-1"], undefined, aAdj.record.routeCashAdjustments);
  const backA = splitCashAdjustmentRefs(refsA);
  expect("A/N: viaja a la nube (real)", backA.routeCashAdjustments?.[0]?.real ?? null, 80_000);
  expect("A/N: viaja a la nube (ruta)", backA.routeCashAdjustments?.[0]?.route ?? null, "A");
  expect("A/N: no se confunde con el ajuste de T", backA.cashAdjustment ?? null, null);
  expect("A/N: refs de movimientos intactas", backA.movementRefs.join(","), "MOV-1");
  const newerA = { ...aAdj.record.routeCashAdjustments[0], real: 70_000, at: "2026-09-27T03:00:00.000Z" };
  const nAdj = { route: "N", calculated: 0, real: 5_000, by: "S", at: "2026-09-27T01:00:00.000Z", reason: "x" };
  const union = mergeRouteCashAdjustments(aAdj.record.routeCashAdjustments, [newerA, nAdj]);
  expect("A/N: unión nube+aparato (un ajuste por ruta)", union?.length ?? null, 2);
  expect("A/N: gana el más reciente", union?.find((r) => r.route === "A")?.real ?? null, 70_000);
}
// N: cobrador sin cadena (Yesid) → caja = efectivo − gastos − préstamos.
const YES = { ref: "COB-1", name: "Yesid" };
const nSrc = {
  collectorRef: YES.ref,
  collectorName: YES.name,
  date: D,
  payments: [{ ...pay("PG-N1", "P-N1", 100_000, D), collectorRef: YES.ref, collector: YES.name }],
  loans: [{ ref: "P-N1", clientRef: "CLI-N1", client: "Eva N", date: "01/09/2026", capital: 400_000, installment: 20_000 }],
  clients: [{ ref: "CLI-N1", name: "Eva", lastName: "N", route: "N" }],
  collectors: [YES],
  assignments: [],
  dayCloses: [],
  dayExpenseDrafts: [
    {
      ref: `GAS-COB-1-${D}`,
      collectorRef: YES.ref,
      collectorName: YES.name,
      date: D,
      routeRef: "",
      expenses: [{ id: "almuerzo", label: "Almuerzo", amount: 10_000, category: "almuerzo" }],
      expensesTotal: 10_000,
      updatedAt: `${D}T12:00:00.000Z`,
    },
  ],
  planillaCashCloses: [],
  monthCloses: [],
};
expect("N 26: caja = efectivo − gastos", independentRouteDay(nSrc, "N").closing, 90_000);
// PCE-T proyectado desde su CIE de ayer (todo CIE- lo genera): no lo vuelve cobrador de la cadena.
const nWithPce = {
  ...nSrc,
  assignments: [{ ...visit("V-N1", "CLI-N1", "N", D), collectorRef: YES.ref, collectorName: YES.name }],
  planillaCashCloses: [
    { ref: `PCE-${YES.ref}-${Y}-T`, collectorRef: YES.ref, collectorName: YES.name, date: Y, routeName: "T", openingCash: 0, closingCash: 0, closedAt: `${Y}T23:30:00.000-05:00` },
  ],
};
expect("N con PCE-T proyectado y planilla solo N: sus gastos cuentan", independentRouteDay(nWithPce, "N").gastos, 10_000);
expect("N con PCE-T proyectado: renglón de gasto en la hoja", independentRouteDayLines(independentRouteDay(nWithPce, "N")).length, 1);
expect("N con PCE-T proyectado: no es cobrador de la cadena", isChainCollectorDay(nWithPce), false);
expect(
  "N ayer con PCE-T proyectado: tampoco es cadena",
  isChainCollectorDay({ ...nWithPce, date: Y }),
  false,
);
const nClosed = sealCollectorDay({
  ...nWithPce,
  routeRef: "RUT-N",
  planillaRoute: "N",
  expensesFallback: nWithPce.dayExpenseDrafts[0].expenses,
  fullyClosed: true,
});
expect(
  "Cerrar N no escribe PCE-M",
  nClosed.planillaCashCloses.some((r) => r.routeName === "M" && r.date === D),
  false,
);
expect(
  "Cerrar N no escribe PCE-T de hoy",
  nClosed.planillaCashCloses.some((r) => r.routeName === "T" && r.date === D),
  false,
);
expect("Cerrar N: CIE es caja de N (sin historial = movimiento del día)", nClosed.record?.cashFloat ?? null, 90_000);
const nClosedDay = sealCollectorDay({
  ...nWithPce,
  routeRef: "RUT-N",
  expensesFallback: nWithPce.dayExpenseDrafts[0].expenses,
  fullyClosed: true,
});
expect(
  "Cerrar jornada N (sin hoja): no PCE-M/T de hoy",
  nClosedDay.planillaCashCloses.some((r) => r.date === D && (r.routeName === "M" || r.routeName === "T")),
  false,
);
expect("Cerrar jornada N: CIE sigue siendo caja de N", nClosedDay.record?.cashFloat ?? null, 90_000);
const nAnchorCie = {
  ref: `CIE-${YES.ref}-${Y}`,
  collectorRef: YES.ref,
  collectorName: YES.name,
  date: Y,
  routeRef: "RUT-N",
  collected: 0,
  expenses: [],
  expensesTotal: 0,
  cashFloat: 50_000,
  closedAt: `${Y}T23:30:00.000-05:00`,
  movementRefs: [],
  routeCashAdjustments: [
    { route: "N", calculated: 0, real: 1_000_000, by: "S", at: `${Y}T21:00:00.000Z`, reason: "conteo N" },
  ],
};
const nWithHist = { ...nWithPce, dayCloses: [nAnchorCie] };
expect("N con historial: Inicial = ajuste, no el CIE neto", independentRouteDay(nWithHist, "N").opening, 1_000_000);
expect("N con historial: caja = Inicial + movimiento", independentRouteDay(nWithHist, "N").closing, 1_090_000);
const nHistClosed = sealCollectorDay({
  ...nWithHist,
  routeRef: "RUT-N",
  planillaRoute: "N",
  expensesFallback: nWithHist.dayExpenseDrafts[0].expenses,
  fullyClosed: true,
});
expect("Cerrar N: CIE es la caja del historial (no el neto del día)", nHistClosed.record?.cashFloat ?? null, 1_090_000);
expect("Cerrar N: Inicial sellado es el del historial", nHistClosed.record?.openingCash ?? null, 1_000_000);
const nPriorDay = "2026-09-24";
const nPriorCie = {
  ...nAnchorCie,
  ref: `CIE-${YES.ref}-${nPriorDay}`,
  date: nPriorDay,
  cashFloat: 99,
};
const nCieNeto = {
  ref: `CIE-${YES.ref}-${Y}`,
  collectorRef: YES.ref,
  collectorName: YES.name,
  date: Y,
  routeRef: "RUT-N",
  collected: 0,
  expenses: [],
  expensesTotal: 0,
  cashFloat: 50_000,
  closedAt: `${Y}T23:30:00.000-05:00`,
  movementRefs: [],
};
const { auditChainFromState } = await import("@/lib/server-chain-audit");
const nAudit = auditChainFromState(
  {
    collectors: [YES],
    assignments: nWithPce.assignments,
    routes: [],
    logs: [],
    dayCloses: [nPriorCie, nCieNeto],
    dayExpenseDrafts: [],
    payments: [],
    loans: nWithPce.loans,
    clients: nWithPce.clients,
    planillaCashCloses: [],
    monthCloses: [],
  },
  D,
);
const nAuditRow = nAudit.rows.find((row) => row.collectorRef === YES.ref);
expect("N: auditoría no usa el CIE neto como Inicial", nAuditRow?.yesterdayCieFloat ?? null, 1_000_000);
expect("N: Inicial de hoy = caja de ayer (historial)", nAuditRow?.todayOpening ?? null, 1_000_000);
expect("N: arrastre del historial OK", nAuditRow?.ok ?? null, true);
expect("N: no entra a la regla M↔T", nAuditRow?.kind ?? null, "independent");
const { defaultMobileRouteDate, defaultOpenPlanillaRoute, collectorHasOpenRouteSheet, keepOpenPlanillaRoute } = await import("@/lib/collector-mobile");
const dayOpt = (date, closed, total) => ({
  date,
  dateLabel: date,
  routeRef: "RUT",
  routeName: "N",
  pending: closed ? 0 : 1,
  done: total,
  total,
  closed,
  allDone: closed,
});
expect(
  "Hoy abierto de N manda sobre un día pasado abierto",
  defaultMobileRouteDate(
    [dayOpt("2026-10-05", true, 138), dayOpt("2026-10-06", false, 138), dayOpt("2026-10-04", false, 10)],
    "2026-10-06",
  ),
  "2026-10-06",
);
const dayOptFull = (date, closed, total) => ({
  date,
  dateLabel: date,
  routeRef: "RUT",
  routeName: "N",
  pending: 0,
  done: total,
  total,
  closed,
  allDone: true,
});
expect(
  "Hoy lleno de N (0 pendientes) manda sobre el cuadre de ayer",
  defaultMobileRouteDate(
    [dayOptFull("2026-10-05", true, 138), dayOptFull("2026-10-06", false, 138)],
    "2026-10-06",
  ),
  "2026-10-06",
);
expect(
  "N ya cerrada en el sistema (0 pendientes) no esconde el día nuevo",
  defaultMobileRouteDate(
    [dayOptFull("2026-10-06", false, 142), dayOptFull("2026-10-05", true, 138)],
    "2026-10-07",
  ),
  "2026-10-05",
);
expect(
  "Mañana sin hoja de N abre el día nuevo, no la hoja sellada de ayer",
  defaultMobileRouteDate(
    [dayOptFull("2026-10-06", false, 142)],
    "2026-10-07",
  ),
  "2026-10-07",
);
const { assertCanCloseChainedPlanilla: nCloseGuard } = await import("@/lib/planilla-cash-chain");
expect(
  "Cerrar N no pide M",
  nCloseGuard({
    collectorRef: YES.ref,
    routeName: "N",
    date: D,
    records: [],
    dayCloses: [],
    assignments: nWithPce.assignments,
    clients: nSrc.clients,
  }).ok,
  true,
);
expect(
  "T sigue pidiendo M (arreglar N no cambia T)",
  nCloseGuard({
    collectorRef: "COB-0",
    routeName: "T",
    date: D,
    records: [],
    dayCloses: [],
    assignments: [],
    clients: [],
  }).ok,
  false,
);
const { planillaCuotaPactada, planillaLiveCuota } = await import("@/lib/planilla-display");
const nLoanZeroInstallment = {
  ref: "P-381",
  clientRef: "CLI-N1",
  capital: 300_000,
  paid: 0,
  balance: 360_000,
  installment: 0,
  status: "Revisar",
  termsPending: true,
  date: "01/10/2026",
  schedule: [{ date: D, kind: "cuota", paid: 0, amount: 15_000 }],
};
expect(
  "Cuota de N: si la ficha perdió installment, sale del cronograma",
  planillaCuotaPactada(nLoanZeroInstallment),
  15_000,
);
expect(
  "Cuota de N: visita Alerta con amountDue 0 no deja el cobro en blanco",
  planillaLiveCuota(
    { ...visit("V-N1", "CLI-N1", "N", D), loanRef: "P-381", amountDue: 0, kind: "alerta" },
    { ...nLoanZeroInstallment, installment: 15_000 },
  ),
  15_000,
);
const chainPins = ["M", "T", "A"];
const chainClients = [
  { ref: "CLI-M1", route: "M" },
  { ref: "CLI-T1", route: "T" },
  { ref: "CLI-A1", route: "A" },
];
const chainVisits = [
  visit("V-M-lock", "CLI-M1", "M", D, { dayClosedAt: `${D}T18:00:00.000Z`, visitStatus: "cobrado" }),
  visit("V-T-open", "CLI-T1", "T", D, { dayClosedAt: null, visitStatus: "pendiente" }),
  visit("V-A-open", "CLI-A1", "A", D, { dayClosedAt: null, visitStatus: "pendiente" }),
];
expect(
  "M cerrada: abre T (el cobrador sigue cobrando)",
  defaultOpenPlanillaRoute(chainPins, chainVisits, D, chainClients),
  "T",
);
expect(
  "M cerrada: aún hay hoja abierta (no cuadre)",
  collectorHasOpenRouteSheet(chainPins, chainVisits, D, chainClients),
  true,
);
expect(
  "CIE de la jornada: ninguna hoja sigue abierta (N y T igual)",
  collectorHasOpenRouteSheet(
    chainPins,
    chainVisits,
    D,
    chainClients,
    [{ ref: `CIE-${COB.ref}-${D}`, collectorRef: COB.ref, date: D, cashFloat: 1 }],
    COB.ref,
  ),
  false,
);
const afterOneTPay = [
  visit("V-M-lock", "CLI-M1", "M", D, { dayClosedAt: `${D}T18:00:00.000Z`, visitStatus: "cobrado" }),
  visit("V-T-paid", "CLI-T1", "T", D, { dayClosedAt: null, visitStatus: "cobrado" }),
];
expect(
  "Cobro en T no apaga el billete (no saltar a M)",
  keepOpenPlanillaRoute("T", chainPins, afterOneTPay, D, chainClients),
  "T",
);
const { assignmentsForCreatedPayments } = await import("@/lib/commit-collector-payment");
const { applyPaymentToAssignments } = await import("@/lib/collector-dispatch-sync");
const tPaidVisit = {
  ...visit("V-T-paid", "CLI-T1", "T", D, { visitStatus: "cobrado" }),
  paymentRef: "PG-T1",
  loanRef: "P-T1",
};
const mixDay = "2026-10-06";
const mixSheet = [
  visit("V-M-lock", "CLI-M1", "M", mixDay, { dayClosedAt: `${mixDay}T18:00:00.000Z`, visitStatus: "cobrado", paymentRef: "PG-M-old", loanRef: "P-M1" }),
  visit("V-T-open", "CLI-T1", "T", mixDay, { dayClosedAt: null, visitStatus: "pendiente", loanRef: "P-T1", amountDue: 20_000 }),
  visit("V-A-open", "CLI-A1", "A", mixDay, { dayClosedAt: null, visitStatus: "pendiente", loanRef: "P-A1", amountDue: 20_000 }),
];
const payTOnly = {
  ref: "PG-T-lock",
  loanRef: "P-T1",
  paidDate: mixDay,
  collectorRef: COB.ref,
  amount: 20_000,
};
const afterTPay = reconcilePaymentsOntoPlanilla(
  applyPaymentToAssignments(mixSheet, payTOnly, mixDay, "CLI-T1"),
  [payTOnly],
);
const mAfter = afterTPay.find((r) => r.itemId === "V-M-lock");
const aAfter = afterTPay.find((r) => r.itemId === "V-A-open");
const tAfter = afterTPay.find((r) => r.itemId === "V-T-open");
expect("Cobro en T no toca M (sello)", mAfter?.dayClosedAt || "", `${mixDay}T18:00:00.000Z`);
expect("Cobro en T no toca M (pago)", mAfter?.paymentRef || "", "PG-M-old");
expect("Cobro en T no toca A", `${aAfter?.visitStatus || ""}:${aAfter?.paymentRef || ""}`, "pendiente:");
expect("Cobro en T solo sella T", tAfter?.visitStatus || "", "cobrado");
expect(
  "Confirmar en T solo encola la visita cobrada (no M+T+A)",
  assignmentsForCreatedPayments(
    [
      visit("V-M-lock", "CLI-M1", "M", D, { dayClosedAt: `${D}T18:00:00.000Z`, visitStatus: "cobrado" }),
      tPaidVisit,
      visit("V-T-open", "CLI-T2", "T", D, { visitStatus: "pendiente" }),
      visit("V-A-open", "CLI-A1", "A", D, { visitStatus: "pendiente" }),
    ],
    [{ ref: "PG-T1", loanRef: "P-T1", paidDate: D }],
  ).map((row) => row.itemId).join(","),
  "V-T-paid",
);
expect("T no cierra si M sigue abierta (única unión entre rutas)", nCloseGuard({
  collectorRef: COB.ref,
  routeName: "T",
  date: D,
  records: [],
  dayCloses: [],
  assignments: [
    visit("V-M-open", "CLI-M1", "M", D, { visitStatus: "pendiente", dayClosedAt: null, loanRef: "P-M1" }),
    visit("V-T-wait", "CLI-T1", "T", D, { visitStatus: "pendiente", dayClosedAt: null, loanRef: "P-T1" }),
  ],
  clients: chainClients,
}).ok, false);
{
  const { readFileSync } = await import("node:fs");
  const payCommitSrc = readFileSync(new URL("../lib/commit-collector-payment.ts", import.meta.url), "utf8");
  expect(
    "Cobro no rearma M+T+A (commit no llama syncPermanentRoutePlanilla)",
    payCommitSrc.includes("syncPermanentRoutePlanilla"),
    false,
  );
  const shellSrc = readFileSync(new URL("../components/CollectorShell.tsx", import.meta.url), "utf8");
  const payFn = shellSrc.slice(
    shellSrc.indexOf("async function registerCollectorPayment"),
    shellSrc.indexOf("async function renewCollectorLoan"),
  );
  expect(
    "Cobrador: confirmar no arma Banco ni rehace la planilla",
    payFn.includes("projectOperationalMoney") || payFn.includes("syncBankLedger"),
    false,
  );
  expect(
    "Cobrador: préstamo / gasto / cierre tampoco arman Banco",
    shellSrc.includes("syncBankLedger"),
    false,
  );
  expect(
    "Cobrador: prestar / renovar / N/P no reenvían la planilla entera",
    /queueAssignmentsMirror\((planilla\.assignments|nextAssignments)\)/.test(shellSrc),
    false,
  );
  const updateSrc = readFileSync(new URL("../lib/app-auto-update.ts", import.meta.url), "utf8");
  expect(
    "Versión nueva obligatoria: la subida previa tiene tope (no cuelga la actualización)",
    updateSrc.includes("flushWithCap()") && !/await flushAllMirrorQueues\(\);/.test(updateSrc),
    true,
  );
  expect(
    "Versión nueva obligatoria: al volver a la app y a los 5 min, sin esperar 2 min quieto",
    updateSrc.includes("FORCE_AFTER_MS") && updateSrc.includes("tick(true)"),
    true,
  );
  const mobileSrc = readFileSync(new URL("../components/CollectorMobileApp.tsx", import.meta.url), "utf8");
  expect(
    "Cobrador: «Crear préstamo» cierra el formulario antes de registrar",
    /closeCard\(true\);\s*onCreateQuickLoan\(draft\)/.test(mobileSrc),
    true,
  );
  const opsSyncSrc = readFileSync(new URL("../lib/operational-sync.ts", import.meta.url), "utf8");
  expect(
    "Cobrador vivo: el ciclo no restaura Haber ni arma el registro Banco",
    opsSyncSrc.includes("isCollectorLiveDevice()") &&
      opsSyncSrc.includes("restoreLoansFromOrphanDisbursements"),
    true,
  );
  const applySync = shellSrc.slice(shellSrc.indexOf("const applyPlanillaSync"));
  const applyBody = applySync.slice(0, applySync.indexOf("usePlanillaDayRollover"));
  expect(
    "Cobrador: el ciclo del día no reenvía toda la planilla",
    applyBody.includes("queueAssignmentsMirror(next.assignments)"),
    false,
  );
  const supervisorSrc = readFileSync(
    new URL("../components/SupervisorShell.tsx", import.meta.url),
    "utf8",
  );
  const supervisorApply = supervisorSrc.slice(supervisorSrc.indexOf("const applyPlanillaSync"));
  const supervisorApplyBody = supervisorApply.slice(
    0,
    supervisorApply.indexOf("usePlanillaDayRollover"),
  );
  expect(
    "Supervisor: el ciclo del día no reenvía toda la planilla",
    supervisorApplyBody.includes("queueAssignmentsMirror(next.assignments)"),
    false,
  );
  const syncSrc = readFileSync(
    new URL("../lib/use-operational-demo-sync.ts", import.meta.url),
    "utf8",
  );
  const hydrateFn = syncSrc.slice(syncSrc.indexOf("const runHydrateWithRemotePull"));
  expect(
    "Supervisor: baja la nube antes de vaciar la cola de planilla",
    hydrateFn.includes("isSupervisorLiveDevice") &&
      hydrateFn.includes("if (!isSupervisorLiveDevice())"),
    true,
  );
  const opsSrc = readFileSync(new URL("../lib/supabase/ops-mirror.ts", import.meta.url), "utf8");
  expect(
    "Supervisor: reconcile no reenvía planilla huérfana",
    opsSrc.includes("Supervisor: no reenviar la planilla como huérfana"),
    true,
  );
  const portfolioSrc = readFileSync(
    new URL("../lib/commit-portfolio-catalog.ts", import.meta.url),
    "utf8",
  );
  const enqueueFn = portfolioSrc.slice(portfolioSrc.indexOf("function enqueuePortfolioMirrors"));
  expect(
    "Catálogo: planilla encolada solo de los clientes tocados",
    enqueueFn.includes("const scoped = clientRefs.size > 0 || loanRefs.size > 0"),
    true,
  );
}

// ── 12. Banco: cada cobro llega a su cuenta según la ruta (A → Nequi; M/T/N → Banco) ──
console.log("\n— Banco: destino del cobro por ruta —");
const { loanRouteIndex, normalizeBankAccount, syncAllPaymentsToMovements } = await import("@/lib/bank");
const bankAccounts = [
  normalizeBankAccount({ ref: "EF", name: "BANCOLOMBIA", bankName: "Efectivo", accountType: "ahorros" }),
  normalizeBankAccount({ ref: "NQ", name: "NEQUI", bankName: "Nequi", accountType: "corriente" }),
  normalizeBankAccount({ ref: "BC", name: "BANCO", bankName: "Banco", accountType: "nequi" }),
];
const bankClients = [
  { ref: "C-A", route: "A" },
  { ref: "C-M", route: "M" },
  { ref: "C-N", route: "N" },
];
const bankLoans = [
  { ref: "L-A", clientRef: "C-A" },
  { ref: "L-M", clientRef: "C-M" },
  { ref: "L-N", clientRef: "C-N" },
];
const bankPay = (ref, loanRef, method) => ({
  ref,
  loanRef,
  method,
  amount: 10_000,
  paidDate: D,
  when: D,
  client: ref,
  collector: "X",
  type: "Cuota",
  kind: "paid",
});
const bankRows = syncAllPaymentsToMovements(
  [
    bankPay("PG-A1", "L-A", "nequi"),
    bankPay("PG-A2", "L-A", "banco"),
    bankPay("PG-A3", "L-A", "efectivo"),
    bankPay("PG-M1", "L-M", "nequi"),
    bankPay("PG-M2", "L-M", "banco"),
    bankPay("PG-N1", "L-N", "nequi"),
    bankPay("PG-M3", "L-M", "efectivo"),
  ],
  [],
  bankAccounts,
  loanRouteIndex(bankLoans, bankClients),
);
const accountOf = (pg) => bankRows.find((row) => row.paymentRef === pg)?.accountRef ?? null;
expect("Banco · A no efectivo (nequi) → Nequi", accountOf("PG-A1"), "NQ");
expect("Banco · A no efectivo (banco) → Nequi", accountOf("PG-A2"), "NQ");
expect("Banco · A efectivo → principal", accountOf("PG-A3"), "EF");
expect("Banco · M no efectivo (nequi) → Banco", accountOf("PG-M1"), "BC");
expect("Banco · M no efectivo (banco) → Banco", accountOf("PG-M2"), "BC");
expect("Banco · N no efectivo → Banco", accountOf("PG-N1"), "BC");
expect("Banco · M efectivo → principal", accountOf("PG-M3"), "EF");

const { lockPaymentCobrosAsIncome } = await import("@/lib/bank");
const voidedFlaca = {
  ...bankPay("PG-10439", "L-M", "nequi"),
  client: "Maria Flaca",
  amount: 50_000,
  type: "Anulado",
  voidedAt: "2026-10-07T03:28:29.769Z",
};
const priorVoidRow = {
  ref: "MOV-VOID",
  accountRef: "BC",
  period: "2026-10",
  description: "Cobro PG-10439",
  valueDate: D,
  opDate: D,
  thirdParty: "Maria Flaca",
  debit: 50_000,
  credit: 0,
  paymentRef: "PG-10439",
  inExtract: true,
  reconciled: false,
  manual: false,
};
const afterVoid = syncAllPaymentsToMovements(
  [bankPay("PG-M3", "L-M", "efectivo"), voidedFlaca],
  [priorVoidRow],
  bankAccounts,
  loanRouteIndex(bankLoans, bankClients),
);
expect(
  "Banco · anulado no queda en registros (Maria Flaca)",
  afterVoid.some((row) => row.paymentRef === "PG-10439"),
  false,
);
expect(
  "Banco · cobro vivo sigue tras anular otro",
  afterVoid.some((row) => row.paymentRef === "PG-M3"),
  true,
);
expect(
  "Banco · lock suelta el PG- anulado",
  lockPaymentCobrosAsIncome([priorVoidRow], [voidedFlaca]).some(
    (row) => row.paymentRef === "PG-10439",
  ),
  false,
);

const { syncNequiLoanDisbursementsToMovements } = await import("@/lib/bank");
const bankClientsWithT = [...bankClients, { ref: "C-T", route: "T" }];
const dsbRows = syncNequiLoanDisbursementsToMovements(
  [
    {
      ref: "P-T1",
      clientRef: "C-T",
      client: "Jose Albornoz",
      capital: 1_000_000,
      date: "06/10/2026",
      fundedBy: "banco",
      notes: "[[fb:banco]]",
    },
    {
      ref: "P-A1",
      clientRef: "C-A",
      client: "A",
      capital: 500_000,
      date: "2026-10-06",
      fundedBy: "nequi",
      notes: "[[fb:nequi]]",
    },
    {
      ref: "P-CASH",
      clientRef: "C-M",
      client: "X",
      capital: 100_000,
      date: "2026-10-06",
      fundedBy: "efectivo",
      notes: "[[fb:efectivo]]",
    },
  ],
  [],
  bankAccounts,
  bankClientsWithT,
);
const dsbOf = (loanRef) =>
  dsbRows.find((row) => row.loanDisbursementRef === `DSB-${loanRef}`)?.accountRef ?? null;
expect("Banco · desembolso T Banco → cuenta Banco", dsbOf("P-T1"), "BC");
expect("Banco · desembolso A Nequi → cuenta Nequi", dsbOf("P-A1"), "NQ");
expect("Banco · efectivo no crea DSB", dsbRows.some((row) => row.loanDisbursementRef === "DSB-P-CASH"), false);
{
  const { readFileSync } = await import("node:fs");
  const bankSrc = readFileSync(new URL("../lib/bank.ts", import.meta.url), "utf8");
  expect(
    "Desembolso DSB usa la ruta del cliente (no la primera cuenta activa)",
    bankSrc.includes("digitalAccountRefForRoute") &&
      bankSrc.includes("sameRoute(route || \"\", \"A\")"),
    true,
  );
  const { loanDisbursementIsoDate } = await import("@/lib/nequi-pool");
  expect(
    "Fecha préstamo con hora = día Bogotá, no UTC",
    loanDisbursementIsoDate({ date: "2026-10-07T03:43:00.000Z" }),
    "2026-10-06",
  );
  expect("Fecha préstamo dd/mm", loanDisbursementIsoDate({ date: "07/10/2026" }), "2026-10-07");
  const dsbTime = syncNequiLoanDisbursementsToMovements(
    [
      {
        ref: "P-T2",
        clientRef: "C-T",
        client: "Jose Albornoz",
        capital: 1_000_000,
        date: "2026-10-07T03:43:00.000Z",
        fundedBy: "banco",
        notes: "[[fb:banco]]",
      },
    ],
    [],
    bankAccounts,
    bankClientsWithT,
  );
  expect(
    "Banco · desembolso con fecha-hora entra el día Bogotá",
    dsbTime.some(
      (row) => row.loanDisbursementRef === "DSB-P-T2" && row.valueDate === "2026-10-06",
    ),
    true,
  );
  const { paymentsForCollectorIncludingOffice, isOfficePayment } = await import("@/lib/nequi-pool");
  const officeBancoPay = {
    ref: "PG-OFF-B",
    loanRef: "P-T1",
    client: "Caro T",
    amount: 298_000,
    paidDate: D,
    method: "banco",
    source: "caja",
    collector: "Caja / oficina",
  };
  const tOfficeRoutes = [
    { ref: "RUT-T", name: "T", collectorRef: COB.ref, collector: COB.name, status: "Activa" },
  ];
  expect("Oficina Banco: se reconoce como cobro del sistema", isOfficePayment(officeBancoPay), true);
  expect(
    "Oficina Banco de T entra al registro Banco (historial) de esa ruta",
    paymentsForCollectorIncludingOffice(
      COB.ref,
      [COB],
      [officeBancoPay],
      clients,
      loans,
      tOfficeRoutes,
    ).some((row) => row.ref === "PG-OFF-B"),
    true,
  );
  const { digitalPoolRegisterDays, digitalPoolDayPayments, digitalPoolDayLedger } = await import("@/lib/digital-pools");
  const officeBancoDays = digitalPoolRegisterDays({
    payments: [officeBancoPay],
    loans,
    clients,
    pool: "banco",
    fromIso: "2026-09-01",
    toIso: "2026-09-27",
    routeName: "T",
  });
  expect(
    "Oficina Banco queda en el día del cobro, no al día siguiente",
    officeBancoDays.map((day) => day.date).join(","),
    D,
  );
  expect("Oficina Banco del día suma 298.000", officeBancoDays[0]?.total ?? 0, 298_000);
  expect("Oficina Banco: sin préstamo, el neto es solo cobros", officeBancoDays[0]?.inflow ?? 0, 298_000);
  expect("Oficina Banco: sin préstamo, no resta capital", officeBancoDays[0]?.outflow ?? 0, 0);
  const officeYeniPay = {
    ref: "PG-OFF-YENI",
    loanRef: "P-T1",
    client: "Yeni Isolina",
    amount: 80_000,
    paidDate: D,
    method: "banco",
    source: "caja",
    collector: "Caja / oficina",
  };
  const srcTOffice = { ...baseT, payments: [...payments, officeBancoPay, officeYeniPay] };
  const bancoTHistorial = digitalPoolDayPayments({
    payments: srcTOffice.payments,
    loans: srcTOffice.loans,
    clients: srcTOffice.clients,
    pool: "banco",
    dateIso: D,
    routeName: "T",
  });
  const cierreTOffice = chainDayCuadre(srcTOffice, "secondary");
  const cierreTBase = chainDayCuadre(baseT, "secondary");
  expect(
    "Regla Banco T = historial Banco T (cobros de esa ruta)",
    cierreTOffice.ownDigital,
    bancoTHistorial.reduce((sum, row) => sum + (row.amount || 0), 0),
  );
  expect("Cierre T · Banco T incluye Yadira 298.000 y Yeni 80.000", cierreTOffice.ownDigital, 378_000);
  expect("Cierre T · cobros de oficina no mueven la caja", cierreTOffice.closing, cierreTBase.closing);
  expect("Cierre T · efectivo intacto con oficina Banco", cierreTOffice.ownEfectivo, cierreTBase.ownEfectivo);
  expect(
    "Libro · oficina Banco no cambia el saldo del día",
    buildDayCashLedger(srcTOffice).dayFinal,
    ledgerT.dayFinal,
  );
  const { digitalLoanPoolForRoute } = await import("@/lib/day-digital-loans");
  expect("Bolsillo A = Nequi (exclusivo)", digitalLoanPoolForRoute("A"), "nequi");
  expect("Bolsillo T = Banco", digitalLoanPoolForRoute("T"), "banco");
  expect("Bolsillo M = Banco", digitalLoanPoolForRoute("M"), "banco");
  expect("Bolsillo N = Banco", digitalLoanPoolForRoute("N"), "banco");
  const officeNequiA = {
    ref: "PG-OFF-A",
    loanRef: "P-A1",
    client: "Dani A",
    amount: 80_000,
    paidDate: D,
    method: "banco",
    source: "caja",
    collector: "Caja / oficina",
  };
  const srcAOffice = { ...base, payments: [...payments, officeNequiA] };
  const nequiAHistorial = digitalPoolDayPayments({
    payments: srcAOffice.payments,
    loans: srcAOffice.loans,
    clients: srcAOffice.clients,
    pool: "nequi",
    dateIso: D,
    routeName: "A",
  });
  const cierreAOffice = independentRouteCollected(srcAOffice, "A");
  expect(
    "Regla Nequi A = historial Nequi A (cobros de esa ruta)",
    cierreAOffice.nequi,
    nequiAHistorial.reduce((sum, row) => sum + (row.amount || 0), 0),
  );
  expect("Regla Nequi A: Banco de A es 0", cierreAOffice.banco, 0);
  expect("Regla Nequi A incluye oficina", cierreAOffice.nequi, 80_000);
  expect(
    "A · oficina Nequi no mueve la caja",
    independentRouteDay(srcAOffice, "A").closing,
    independentRouteDay(base, "A").closing,
  );
  expect(
    "Nequi A no entra al historial Banco",
    digitalPoolDayPayments({
      payments: srcAOffice.payments,
      loans: srcAOffice.loans,
      clients: srcAOffice.clients,
      pool: "banco",
      dateIso: D,
      routeName: "A",
    }).length,
    0,
  );
  const officeBancoM = {
    ref: "PG-OFF-M",
    loanRef: "P-M1",
    client: "Ana M",
    amount: 40_000,
    paidDate: D,
    method: "banco",
    source: "caja",
    collector: "Caja / oficina",
  };
  const srcMOffice = { ...baseT, payments: [...payments, officeBancoM] };
  const bancoMHistorial = digitalPoolDayPayments({
    payments: srcMOffice.payments,
    loans: srcMOffice.loans,
    clients: srcMOffice.clients,
    pool: "banco",
    dateIso: D,
    routeName: "M",
  });
  const cierreMOffice = chainDayCuadre(srcMOffice, "primary");
  expect(
    "Regla Banco M = historial Banco M (cobros de esa ruta)",
    cierreMOffice.ownDigital,
    bancoMHistorial.reduce((sum, row) => sum + (row.amount || 0), 0),
  );
  expect("Regla Banco M incluye oficina", cierreMOffice.ownDigital, 140_000);
  expect(
    "M · oficina Banco no mueve la caja",
    cierreMOffice.closing,
    chainDayCuadre(baseT, "primary").closing,
  );
  const officeBancoN = {
    ref: "PG-OFF-N",
    loanRef: "P-N1",
    client: "Eva N",
    amount: 50_000,
    paidDate: D,
    method: "nequi",
    source: "caja",
    collector: "Caja / oficina",
  };
  const srcNOffice = { ...nSrc, payments: [...nSrc.payments, officeBancoN] };
  const bancoNHistorial = digitalPoolDayPayments({
    payments: srcNOffice.payments,
    loans: srcNOffice.loans,
    clients: srcNOffice.clients,
    pool: "banco",
    dateIso: D,
    routeName: "N",
  });
  const cierreNOffice = independentRouteCollected(srcNOffice, "N");
  expect(
    "Regla Banco N = historial Banco N (cobros de esa ruta)",
    cierreNOffice.banco,
    bancoNHistorial.reduce((sum, row) => sum + (row.amount || 0), 0),
  );
  expect("Regla Banco N: Nequi de N es 0", cierreNOffice.nequi, 0);
  expect(
    "Lista Banco N (Cierre) = cifra del botón",
    cierreNOffice.digitalPayments.reduce((sum, row) => sum + (row.amount || 0), 0),
    cierreNOffice.banco,
  );
  expect(
    "Lista Banco N = mismos renglones del historial",
    cierreNOffice.digitalPayments.map((row) => row.ref).sort().join(","),
    bancoNHistorial.map((row) => row.ref).sort().join(","),
  );
  expect("Regla Banco N incluye oficina", cierreNOffice.banco, 50_000);
  expect(
    "N · oficina Banco no mueve la caja",
    independentRouteDay(srcNOffice, "N").closing,
    independentRouteDay(nSrc, "N").closing,
  );
  expect(
    "Oficina Banco no entra al día siguiente",
    digitalPoolDayPayments({
      payments: [officeBancoPay],
      loans,
      clients,
      pool: "banco",
      dateIso: "2026-09-27",
      routeName: "T",
    }).length,
    0,
  );
  const cesarReyN = { ref: "CLI-N-CESAR", name: "Cesar", lastName: "Rey", route: "N" };
  const cesarResT = { ref: "CLI-T-CESAR", name: "Cesar", lastName: "Res", route: "T" };
  const mixClients = [...nSrc.clients, cesarReyN, cesarResT];
  const mixLoans = [
    ...nSrc.loans,
    { ref: "P-N-CESAR", clientRef: cesarReyN.ref, client: "Cesar Rey", date: "01/09/2026", capital: 100_000, installment: 10_000 },
    { ref: "P-T-CESAR", clientRef: cesarResT.ref, client: "Cesar", date: "01/09/2026", capital: 100_000, installment: 10_000 },
  ];
  const tCesarPay = {
    ref: "PG-T-CESAR",
    loanRef: "P-T-CESAR",
    client: "Cesar",
    amount: 20_000,
    paidDate: D,
    method: "nequi",
    collectorRef: COB.ref,
  };
  const nCesarPay = {
    ref: "PG-N-CESAR",
    loanRef: "P-N-CESAR",
    client: "Cesar Rey",
    amount: 15_000,
    paidDate: D,
    method: "nequi",
    collectorRef: YES.ref,
  };
  const bancoNSinT = digitalPoolDayPayments({
    payments: [tCesarPay, nCesarPay],
    loans: mixLoans,
    clients: mixClients,
    pool: "banco",
    dateIso: D,
    routeName: "N",
  });
  const bancoTSinN = digitalPoolDayPayments({
    payments: [tCesarPay, nCesarPay],
    loans: mixLoans,
    clients: mixClients,
    pool: "banco",
    dateIso: D,
    routeName: "T",
  });
  expect(
    "Banco N no mete cobros de T aunque el nombre se parezca",
    bancoNSinT.some((row) => row.ref === "PG-T-CESAR") ? 1 : 0,
    0,
  );
  expect(
    "Banco N no lista Nequi del cobrador (N sigue en cero)",
    bancoNSinT.some((row) => row.ref === "PG-N-CESAR") ? 1 : 0,
    0,
  );
  expect(
    "Banco N sí lista una consignación Banco de la ficha N",
    digitalPoolDayPayments({
      payments: [
        {
          ref: "PG-N-BANCO",
          loanRef: "P-N-CESAR",
          client: "Cesar Rey",
          amount: 15_000,
          paidDate: D,
          method: "banco",
          collectorRef: YES.ref,
        },
      ],
      loans: mixLoans,
      clients: mixClients,
      pool: "banco",
      dateIso: D,
      routeName: "N",
    }).some((row) => row.ref === "PG-N-BANCO")
      ? 1
      : 0,
    1,
  );
  expect(
    "Banco T no mete cobros de N aunque el nombre se parezca",
    bancoTSinN.some((row) => row.ref === "PG-N-CESAR") ? 1 : 0,
    0,
  );
  expect(
    "Banco T sí lista el cobro de la ficha T",
    bancoTSinN.some((row) => row.ref === "PG-T-CESAR") ? 1 : 0,
    1,
  );
  const bancoLoanT = {
    ref: "P-BT-REG",
    clientRef: "CLI-T1",
    client: "Caro T",
    date: "26/09/2026",
    capital: 1_000_000,
    installment: 30_000,
    total: 1_300_000,
    fundedBy: "banco",
    status: "Revisar",
    updatedAt: "2026-09-26T20:30:00.000Z",
  };
  const bancoDayWithLoan = digitalPoolDayLedger({
    payments: [officeBancoPay],
    loans: [...loans, bancoLoanT],
    clients,
    pool: "banco",
    dateIso: D,
    routeName: "T",
  });
  expect("Historial Banco: cobros del día siguen sumando", bancoDayWithLoan.inflow, 298_000);
  expect("Historial Banco: el préstamo resta solo el capital", bancoDayWithLoan.outflow, 1_000_000);
  expect("Historial Banco: neto del día = cobros − capital", bancoDayWithLoan.total, -702_000);
  expect("Historial Banco: un solo renglón de préstamo", bancoDayWithLoan.loans.length, 1);
  expect("Historial Banco: el renglón lleva el capital, no el total", bancoDayWithLoan.loans[0]?.capital ?? 0, 1_000_000);
  const { loanBankOutflowCapital } = await import("@/lib/nequi-pool");
  expect(
    "Banco: capital 1M + interés 300k = sale 1M",
    loanBankOutflowCapital({ capital: 1_000_000, interest: 300_000, total: 1_300_000 }),
    1_000_000,
  );
  expect(
    "Banco: nunca sale el total a cobrar",
    loanBankOutflowCapital({ capital: 1_300_000, interest: 260_000, total: 1_560_000 }),
    1_300_000,
  );
  expect(
    "Banco: Alcira y Juan 2 se quedan con su capital (no se recortan)",
    loanBankOutflowCapital({ capital: 600_000, interest: 120_000, total: 720_000 }),
    600_000,
  );
  const nequiPoolSrc = readFileSync(new URL("../lib/nequi-pool.ts", import.meta.url), "utf8");
  expect(
    "Dueño Banco: loanBankOutflowCapital (nunca total ni interés)",
    nequiPoolSrc.includes("export function loanBankOutflowCapital") &&
      nequiPoolSrc.includes("Nunca `total`"),
    true,
  );
  const digitalPoolSrc = readFileSync(new URL("../lib/digital-pools.ts", import.meta.url), "utf8");
  expect(
    "Historial Banco resta loanBankOutflowCapital",
    digitalPoolSrc.includes("loanBankOutflowCapital(loan)"),
    true,
  );
  expect(
    "Banco de la ruta = ficha del Listado, nunca por nombre",
    digitalPoolSrc.includes("sameRoute(paymentClientRoute") &&
      digitalPoolSrc.includes("function paymentMatchesPoolRoute") &&
      !digitalPoolSrc.includes("const needle"),
    true,
  );
  expect(
    "Banco: un solo libro (historial = acumulado)",
    digitalPoolSrc.includes("isPoolRegisterPayment(row, src.loans, src.clients, pool)") &&
      digitalPoolSrc.includes("collectPoolOutflowLoans({") &&
      !digitalPoolSrc.includes("paymentsForCollector("),
    true,
  );
  expect(
    "Prestado Banco: un cliente un día un capital = un renglón",
    digitalPoolSrc.includes("uniquePoolRegisterLoans") &&
      digitalPoolSrc.includes("preferPoolOutflowRow"),
    true,
  );
  const bancoSrc = readFileSync(new URL("../components/SupervisorMobileApp.tsx", import.meta.url), "utf8");
  expect(
    "Registro Banco muestra el nombre de la ficha, no un apodo de otra ruta",
    bancoSrc.includes("paymentCatalogClientName(pay, loans, clients)"),
    true,
  );
  expect(
    "Supervisor Banco: el azul es capital, no total",
    bancoSrc.includes("money(-row.capital") && !bancoSrc.includes("money(-row.total"),
    true,
  );
  expect(
    "Historial Banco: efectivo del mismo día no sale del Banco",
    digitalPoolDayLedger({
      payments: [officeBancoPay],
      loans: [...loans, { ...bancoLoanT, fundedBy: "efectivo" }],
      clients,
      pool: "banco",
      dateIso: D,
      routeName: "T",
    }).outflow,
    0,
  );
  expect(
    "Historial Banco: un día solo con préstamo igual se lista",
    digitalPoolRegisterDays({
      payments: [],
      loans: [bancoLoanT],
      clients,
      pool: "banco",
      fromIso: "2026-09-01",
      toIso: "2026-09-27",
      routeName: "T",
    }).map((day) => `${day.date}:${day.outflow}`).join(","),
    `${D}:1000000`,
  );
  expect(
    "Historial Banco: préstamo de A no entra a T",
    digitalPoolDayLedger({
      payments: [],
      loans: [{ ...bancoLoanT, ref: "P-BA", clientRef: "CLI-A1", client: "Dani A" }],
      clients,
      pool: "banco",
      dateIso: D,
      routeName: "T",
    }).outflow,
    0,
  );
  expect(
    "Supervisor Banco: préstamos en azul y saldo del día",
    bancoSrc.includes("is-outflow") && bancoSrc.includes("Saldo del día"),
    true,
  );
  expect(
    "Supervisor Banco no toca el pie de INICIO",
    bancoSrc.includes("inicioTotalConT") && bancoSrc.includes("bancoPanelAcumulado"),
    true,
  );
  const ledgerSrc = readFileSync(new URL("../lib/day-cash-ledger.ts", import.meta.url), "utf8");
  expect(
    "Regla Banco T: el botón lee digitalPoolDayPayments (no recaudo del cobrador a solas)",
    ledgerSrc.includes("function routeDigitalPayments") &&
      ledgerSrc.includes("return digitalPoolDayPayments({") &&
      ledgerSrc.includes("export function routeDigitalCollected") &&
      ledgerSrc.includes("ownDigital: digitalPaymentsTotal(digital.own)"),
    true,
  );
  expect(
    "Regla Banco T: Cierre del supervisor muestra ownDigital",
    bancoSrc.includes("Banco T") && bancoSrc.includes("historyDayChainT.ownDigital"),
    true,
  );
  const indepSrc = readFileSync(new URL("../lib/independent-route-cash.ts", import.meta.url), "utf8");
  expect(
    "Regla Nequi A / Banco N: A y N leen routeDigitalCollected",
    indepSrc.includes("routeDigitalCollected(src, route)"),
    true,
  );
  expect(
    "Regla Nequi A: Cierre del supervisor muestra Nequi de A",
    bancoSrc.includes("historyDayNequiBoxAmount") && bancoSrc.includes("openRouteIsA"),
    true,
  );
  expect(
    "INICIO ruta: Banco / Nequi leen routeDigitalCollected",
    bancoSrc.includes("routeDigitalCollected"),
    true,
  );
  expect(
    "Registro Banco lista historial cobrado y prestado por día",
    bancoSrc.includes("is-cobrado-hist") &&
      bancoSrc.includes("is-prestado-hist") &&
      bancoSrc.includes("bancoRouteHistoryDays") &&
      bancoSrc.includes("bancoRouteHistoryTotals") &&
      bancoSrc.includes("bancoRouteCobradoHistoryDays") &&
      bancoSrc.includes("bancoRoutePrestadoHistoryDays"),
    true,
  );
  expect(
    "Registro Nequi: cobrado, prestado y saldo de la ruta A",
    bancoSrc.includes("nequiRouteHistoryDays") &&
      bancoSrc.includes("NEQUI_ROUTE_PIN") &&
      bancoSrc.includes("is-nequi-tres") &&
      bancoSrc.includes("is-nequi-saldo"),
    true,
  );
  expect(
    "Banco/Nequi: el día en curso queda habilitado",
    bancoSrc.includes("bancoRouteCobradoHistoryDays(bancoRutaHistoryDays, today)") &&
      bancoSrc.includes("bancoRoutePrestadoHistoryDays(bancoRutaHistoryDays, today)") &&
      bancoSrc.includes("bancoRouteCobradoHistoryDays(nequiRutaHistoryDays, today)") &&
      bancoSrc.includes("bancoRoutePrestadoHistoryDays(nequiRutaHistoryDays, today)"),
    true,
  );
  expect(
    "Banco: rutas M T N + acumulado de saldos",
    bancoSrc.includes("BANCO_ROUTE_PINS") &&
      bancoSrc.includes("bancoRouteCuadre") &&
      bancoSrc.includes("bancoAcumuladoRutas") &&
      bancoSrc.includes("Acumulado (M + T + N)") &&
      bancoSrc.includes("Ruta M"),
    true,
  );
  const catalogSrc = readFileSync(new URL("../lib/supabase/catalog-mirror.ts", import.meta.url), "utf8");
  expect(
    "Préstamo: un P- no pisa el de otro cliente",
    catalogSrc.includes("currentClient !== row.client_ref") &&
      catalogSrc.includes("rekeyCollidingLocalLoans"),
    true,
  );
  const wsSrc = readFileSync(new URL("../components/workspace/useWorkspace.ts", import.meta.url), "utf8");
  const applyPortfolio = wsSrc.slice(wsSrc.indexOf("async function applyPortfolioCommit"));
  expect(
    "Nuevo préstamo no reenvía toda la planilla",
    applyPortfolio.includes("focusLoan") &&
      applyPortfolio.includes("row.loanRef === focusLoan"),
    true,
  );
}

// ── 13. Cuadre del total acumulado BANCO / NEQUI: con todas las rutas cerradas hoy.
//     El real ancla el pool; desde mañana suma sobre él. Cajas, CIE y cadena intactos.
console.log("\n— Cuadre BANCO / NEQUI —");
const {
  commitDigitalPoolAdjustment,
  digitalPoolAdjustWindow,
  digitalPoolBalances,
  digitalPoolRegisterDays,
  bancoRouteCuadre,
  bancoAcumuladoRutas,
  bancoRouteHistoryDays,
  bancoRouteHistoryTotals,
  bancoRouteCobradoHistoryDays,
  bancoRoutePrestadoHistoryDays,
  nequiRouteHistoryDays,
} = await import("@/lib/digital-pools");
const poolPay = (ref, loanRef, method, date) => ({
  ...bankPay(ref, loanRef, method),
  paidDate: date,
  collectorRef: COB.ref,
  collector: COB.name,
});
const poolSrc = {
  payments: [
    poolPay("PG-PA", "L-A", "banco", D),
    poolPay("PG-PM", "L-M", "nequi", D),
    poolPay("PG-PE", "L-M", "efectivo", D),
  ],
  loans: bankLoans,
  clients: bankClients,
  collectors: [COB],
  collectorRefs: [COB.ref],
  dayCloses: afterT.dayCloses,
};
const pools0 = digitalPoolBalances(poolSrc);
expect("Pool: lo digital de M va a Banco (aunque diga nequi)", pools0.banco, 10_000);
expect("Pool: lo digital de A va a Nequi (aunque diga banco)", pools0.nequi, 10_000);
{
  const bancoDays = digitalPoolRegisterDays({
    payments: poolSrc.payments,
    loans: poolSrc.loans,
    clients: poolSrc.clients,
    pool: "banco",
    fromIso: "2026-09-01",
    toIso: D,
  });
  const nequiDays = digitalPoolRegisterDays({
    payments: poolSrc.payments,
    loans: poolSrc.loans,
    clients: poolSrc.clients,
    pool: "nequi",
    fromIso: "2026-09-01",
    toIso: D,
  });
  expect(
    "Pool: acumulado Banco = suma − resta del historial",
    pools0.banco,
    bancoDays.reduce((sum, day) => sum + day.total, 0),
  );
  expect(
    "Pool: acumulado Nequi = suma − resta del historial",
    pools0.nequi,
    nequiDays.reduce((sum, day) => sum + day.total, 0),
  );
  const yesidNequiN = {
    ref: "PG-N-PWA",
    loanRef: "L-N",
    client: "Eva N",
    amount: 180_000,
    paidDate: D,
    method: "nequi",
    source: "pwa",
    collectorRef: "COB-1",
    collector: "Yesid",
  };
  expect(
    "Pool: Nequi del cobrador de N no mueve Banco (N sigue en cero)",
    digitalPoolBalances({ ...poolSrc, payments: [...poolSrc.payments, yesidNequiN] }).banco,
    pools0.banco,
  );
  expect(
    "Pool: un cobro de otro cobrador sí entra al acumulado",
    digitalPoolBalances({
      ...poolSrc,
      payments: [
        ...poolSrc.payments,
        { ...poolPay("PG-OTRO", "L-M", "nequi", D), collectorRef: "COB-X", collector: "Otro" },
      ],
    }).banco,
    20_000,
  );
  const cuadreArgs = {
    payments: poolSrc.payments,
    loans: poolSrc.loans,
    clients: poolSrc.clients,
    dayCloses: [],
    fromIso: "2026-09-01",
    dateIso: D,
  };
  const mCuadre = bancoRouteCuadre({ ...cuadreArgs, routeName: "M" });
  const tCuadre = bancoRouteCuadre({ ...cuadreArgs, routeName: "T" });
  const nCuadre = bancoRouteCuadre({ ...cuadreArgs, routeName: "N" });
  expect("Banco ruta M: cobrado del día", mCuadre.cobrado, 10_000);
  expect("Banco ruta M: inicio del primer día = 0", mCuadre.inicio, 0);
  expect("Banco ruta M: saldo = inicio + cobrado − prestado", mCuadre.saldo, 10_000);
  expect("Banco ruta T: sin movimiento = 0", tCuadre.saldo, 0);
  expect("Banco ruta N: sigue en cero", nCuadre.cobrado, 0);
  expect(
    "Banco acumulado = saldo M + T + N",
    bancoAcumuladoRutas([mCuadre, tCuadre, nCuadre]),
    10_000,
  );
  const mNextDay = bancoRouteCuadre({
    ...cuadreArgs,
    dateIso: "2026-09-27",
    payments: [...poolSrc.payments, poolPay("PG-PM2", "L-M", "nequi", "2026-09-27")],
  });
  expect("Banco ruta: el inicio de mañana es el saldo de hoy", mNextDay.inicio, 10_000);
  expect("Banco ruta: saldo de mañana arrastra", mNextDay.saldo, 20_000);
  const mHist = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: "2026-09-27",
    routeName: "M",
    payments: [...poolSrc.payments, poolPay("PG-PM2", "L-M", "nequi", "2026-09-27")],
  });
  const hist26 = mHist.find((day) => day.date === D);
  const hist27 = mHist.find((day) => day.date === "2026-09-27");
  expect("Banco historial M: día 1 inicial 0", hist26?.inicio, 0);
  expect("Banco historial M: día 1 final = cobrado", hist26?.saldo, 10_000);
  expect("Banco historial M: día 2 inicial = final de ayer", hist27?.inicio, 10_000);
  expect("Banco historial M: día 2 final arrastra", hist27?.saldo, 20_000);
  expect(
    "Banco historial M: botón cobrado = suma de todos los días",
    bancoRouteHistoryTotals(mHist).cobrado,
    20_000,
  );
  expect(
    "Banco historial M: botón prestado a la fecha",
    bancoRouteHistoryTotals(mHist).prestado,
    0,
  );
  const mCobrado = bancoRouteCobradoHistoryDays(mHist);
  const cob26 = mCobrado.find((day) => day.date === D);
  const cob27 = mCobrado.find((day) => day.date === "2026-09-27");
  expect("Banco cobrado: día 1 inicial 0", cob26?.inicio, 0);
  expect("Banco cobrado: día 1 final = cobrado (no resta)", cob26?.final, 10_000);
  expect("Banco cobrado: día 2 inicial = final de ayer", cob27?.inicio, 10_000);
  expect("Banco cobrado: día 2 final arrastra solo cobrado", cob27?.final, 20_000);
  expect(
    "Banco cobrado: botón = suma a la fecha",
    bancoRouteHistoryTotals(mHist).cobrado,
    cob27?.final,
  );
  const mHistLoan = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: "2026-09-27",
    routeName: "M",
    payments: [...poolSrc.payments, poolPay("PG-PM2", "L-M", "nequi", "2026-09-27")],
    loans: [
      ...poolSrc.loans,
      {
        ref: "P-M-BCO",
        clientRef: "C-M",
        client: "M",
        date: "26/09/2026",
        capital: 4_000,
        fundedBy: "banco",
      },
    ],
  });
  const mixed26 = mHistLoan.find((day) => day.date === D);
  const cobLoan26 = bancoRouteCobradoHistoryDays(mHistLoan).find((day) => day.date === D);
  expect("Banco cobrado: el préstamo baja el saldo mixto", mixed26?.saldo, 6_000);
  expect("Banco cobrado: el renglón no resta el préstamo", cobLoan26?.final, 10_000);
  const mPrestado = bancoRoutePrestadoHistoryDays(mHistLoan);
  const pre26 = mPrestado.find((day) => day.date === D);
  expect("Banco prestado: el primer día inicial = 0", pre26?.inicio, 0);
  expect("Banco prestado: final = solo capital prestado", pre26?.final, 4_000);
  expect("Banco prestado: no arrastra el cobrado", pre26?.inicio, 0);
  const aHist = nequiRouteHistoryDays({
    payments: poolSrc.payments,
    loans: poolSrc.loans,
    clients: poolSrc.clients,
    dayCloses: [],
    fromIso: "2026-09-01",
    toIso: D,
  });
  expect(
    "Nequi historial: solo ruta A",
    aHist.every((day) => day.route === "A"),
    true,
  );
  expect("Nequi cobrado: entra el de A", aHist.find((day) => day.date === D)?.cobrado, 10_000);
  expect(
    "Nequi no mezcla cobros de M",
    aHist.some((day) => day.items.some((row) => row.ref === "PG-PM")),
    false,
  );
  const aCobrado = bancoRouteCobradoHistoryDays(aHist);
  const aCob26 = aCobrado.find((day) => day.date === D);
  expect("Nequi cobrado: día 1 inicial 0", aCob26?.inicio, 0);
  expect("Nequi cobrado: día 1 final = cobrado (no resta)", aCob26?.final, 10_000);
  expect(
    "Nequi cobrado: botón = suma a la fecha",
    bancoRouteHistoryTotals(aHist).cobrado,
    10_000,
  );
  const aHistLoan = nequiRouteHistoryDays({
    payments: poolSrc.payments,
    loans: [
      ...poolSrc.loans,
      {
        ref: "P-A-NQ",
        clientRef: "C-A",
        client: "A",
        date: "26/09/2026",
        capital: 3_000,
        fundedBy: "banco",
      },
      {
        ref: "P-M-NQ",
        clientRef: "C-M",
        client: "M",
        date: "26/09/2026",
        capital: 9_000,
        fundedBy: "nequi",
      },
    ],
    clients: poolSrc.clients,
    dayCloses: [],
    fromIso: "2026-09-01",
    toIso: D,
  });
  const aPre = bancoRoutePrestadoHistoryDays(aHistLoan);
  const aPre26 = aPre.find((day) => day.date === D);
  expect("Nequi prestado: solo capital de A", aPre26?.prestado, 3_000);
  expect("Nequi prestado: el primer día inicial = 0", aPre26?.inicio, 0);
  expect("Nequi prestado: final = solo capital prestado", aPre26?.final, 3_000);
  expect(
    "Nequi no lista préstamo de M",
    aPre.some((day) => day.loans.some((row) => row.loanRef === "P-M-NQ")),
    false,
  );
  expect(
    "Nequi saldo = cobrado − prestado de A",
    aHistLoan.find((day) => day.date === D)?.saldo,
    7_000,
  );
  const HOY = "2026-09-27";
  const mLive = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: HOY,
    routeName: "M",
    payments: poolSrc.payments,
  });
  expect("Banco: el día en curso sale aunque aún no cobre", mLive.some((day) => day.date === HOY), true);
  expect("Banco: día en curso inicial = final de ayer", mLive.find((day) => day.date === HOY)?.inicio, 10_000);
  expect("Banco: día en curso cobrado 0 hasta que entre plata", mLive.find((day) => day.date === HOY)?.cobrado, 0);
  const mLiveCob = bancoRouteCobradoHistoryDays(mLive, HOY);
  expect("Banco cobrado: renglón de hoy habilitado", mLiveCob.find((day) => day.date === HOY)?.cobrado, 0);
  expect("Banco cobrado: final de hoy arrastra", mLiveCob.find((day) => day.date === HOY)?.final, 10_000);
  const mLivePay = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: HOY,
    routeName: "M",
    payments: [...poolSrc.payments, poolPay("PG-HOY", "L-M", "nequi", HOY)],
  });
  expect("Banco: el cobro de hoy entra al instante en M", mLivePay.find((day) => day.date === HOY)?.cobrado, 10_000);
  const tLive = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: HOY,
    routeName: "T",
    payments: [...poolSrc.payments, poolPay("PG-HOY", "L-M", "nequi", HOY)],
  });
  expect("Banco: cobro de M no entra al día en curso de T", tLive.find((day) => day.date === HOY)?.cobrado, 0);
  const mLiveLoan = bancoRouteHistoryDays({
    ...cuadreArgs,
    toIso: HOY,
    routeName: "M",
    payments: poolSrc.payments,
    loans: [
      ...poolSrc.loans,
      {
        ref: "P-HOY-M",
        clientRef: "C-M",
        client: "M",
        date: "27/09/2026",
        capital: 4_000,
        fundedBy: "banco",
      },
    ],
  });
  const mLivePre = bancoRoutePrestadoHistoryDays(mLiveLoan, HOY);
  expect(
    "Banco prestado: préstamo del sistema/supervisor entra hoy en su ruta",
    mLivePre.find((day) => day.date === HOY)?.prestado,
    4_000,
  );
  const aLiveLoan = nequiRouteHistoryDays({
    payments: poolSrc.payments,
    loans: [
      ...poolSrc.loans,
      {
        ref: "P-HOY-A",
        clientRef: "C-A",
        client: "A",
        date: "27/09/2026",
        capital: 2_000,
        fundedBy: "nequi",
      },
    ],
    clients: poolSrc.clients,
    dayCloses: [],
    fromIso: "2026-09-01",
    toIso: HOY,
  });
  const aLivePre = bancoRoutePrestadoHistoryDays(aLiveLoan, HOY);
  expect(
    "Nequi prestado: préstamo de A entra hoy; M no se mezcla",
    aLivePre.find((day) => day.date === HOY)?.prestado,
    2_000,
  );
}
{
  const digitalLoan = (ref, clientRef, fundedBy) => ({
    ref,
    clientRef,
    client: ref,
    date: "26/09/2026",
    capital: 4_000,
    fundedBy,
  });
  const withLoans = digitalPoolBalances({
    ...poolSrc,
    loans: [
      ...bankLoans,
      digitalLoan("P-SUP-B", "C-M", "banco"),
      { ...digitalLoan("P-SUP-N", "C-M", "nequi"), capital: 5_000 },
      digitalLoan("P-SUP-A", "C-A", "banco"),
      digitalLoan("P-SUP-E", "C-M", "efectivo"),
    ],
  });
  expect("Pool: préstamo por Banco (supervisor) a cliente de M sale de BANCO", pools0.banco - withLoans.banco, 9_000);
  expect("Pool: préstamo por Banco a cliente de A sale de NEQUI (manda la ruta)", pools0.nequi - withLoans.nequi, 4_000);
  const supBancoT = { ref: "P-SUP-T", clientRef: "CLI-T1", client: "Caro T", date: "26/09/2026", capital: 600_000, fundedBy: "banco" };
  const cashWithBanco = buildDayCashLedger({ ...base, loans: [...loans, supBancoT] });
  expect("Pool: préstamo por Banco no toca la caja de T", cashWithBanco.dayFinal, buildDayCashLedger(base).dayFinal);
}
expect(
  "Pool: con una ruta sin cerrar no se cuadra",
  digitalPoolAdjustWindow([{ ref: COB.ref }, { ref: "COB-X", name: "Otro" }], afterT.dayCloses, adjNow).open,
  false,
);
expect("Pool: todas cerradas → se cuadra", digitalPoolAdjustWindow([{ ref: COB.ref }], afterT.dayCloses, adjNow).open, true);
const poolAdj = commitDigitalPoolAdjustment({
  pool: "banco",
  real: 500_000,
  reason: "Saldo real del banco",
  by: "Supervisor",
  calculated: pools0.banco,
  collectors: [{ ref: COB.ref }],
  dayCloses: afterT.dayCloses,
  now: adjNow,
});
expect("Pool: se registra", poolAdj.ok, true);
if (poolAdj.ok) {
  const adjCie = poolAdj.records[0];
  expect("Pool: CIE cash_float intacto (cadena)", adjCie.cashFloat, cieAfterT26?.cashFloat ?? null);
  expect("Pool: ajuste de T intacto", adjCie.cashAdjustment ?? null, cieAfterT26?.cashAdjustment ?? null);
  const poolsToday = digitalPoolBalances({ ...poolSrc, dayCloses: poolAdj.dayCloses });
  expect("Pool: hoy Banco = real", poolsToday.banco, 500_000);
  expect("Pool: Nequi no se toca", poolsToday.nequi, 10_000);
  expect(
    "Pool: calculado (sin el ajuste de hoy) = sistema",
    digitalPoolBalances({ ...poolSrc, dayCloses: poolAdj.dayCloses }, D).banco,
    10_000,
  );
  const poolsNext = digitalPoolBalances({
    ...poolSrc,
    dayCloses: poolAdj.dayCloses,
    payments: [...poolSrc.payments, poolPay("PG-PM2", "L-M", "nequi", "2026-09-27")],
  });
  expect("Pool: mañana = real + lo nuevo", poolsNext.banco, 510_000);
  const mNextPool = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: "2026-09-27",
    records: afterT.planillaCashCloses,
    monthCloses: [],
    dayCloses: poolAdj.dayCloses,
  });
  expect("Pool: Inicial M 27 sigue siendo el CIE-26", mNextPool.kind === "chain" ? mNextPool.opening : null, 3_084_000);
  expect(
    "Pool: saldo propio de A intacto",
    independentRouteDay({ ...base, dayCloses: poolAdj.dayCloses }, "A").closing,
    aDay26.closing,
  );
  const poolBack = splitCashAdjustmentRefs(
    joinCashAdjustmentRefs([], adjCie.cashAdjustment, adjCie.routeCashAdjustments),
  );
  expect(
    "Pool: viaja a la nube",
    poolBack.routeCashAdjustments?.find((r) => r.route === "POOL-BANCO")?.real ?? null,
    500_000,
  );
}

// ── 14. Prestar atendido: el cliente recibió préstamo hoy. Su visita «Prestar» queda
//     resuelta (y cerrada si su hoja ya cerró); no desaparece para que la copia abierta
//     de la nube no bloquee el sello de la jornada (CIE-).
console.log("\n— Prestar atendido no bloquea el cierre —");
const { syncPermanentRoutePlanilla } = await import("@/lib/route-planilla");
const { collectorDayVisitsFullyClosed } = await import("@/lib/collector-dispatch-sync");
const pDate = "2026-09-30";
const pClients = [
  { ref: "CLI-P1", name: "Flaca", lastName: "M", route: "M", status: "Activo", routeOrder: 1 },
  { ref: "CLI-P2", name: "Sady", lastName: "M", route: "M", status: "Activo", routeOrder: 2 },
];
const pRoutes = [{ ref: "RUT-M", name: "M", collectorRef: COB.ref, collector: COB.name, status: "Activa", stops: [] }];
const pLoans = [
  { ref: "P-P1", clientRef: "CLI-P1", client: "Flaca M", date: "30/09/2026", capital: 300_000, total: 360_000, installment: 15_000, status: "Revisar" },
];
const closedAt = `${pDate}T21:41:00.000Z`;
const pExisting = [
  visit(`${pDate}:CLI-P1:prestar`, "CLI-P1", "M", pDate, { visitStatus: "pendiente", awaitingLoan: true, chargeLabel: "Prestar" }),
  visit(`${pDate}:CLI-P2:prestar`, "CLI-P2", "M", pDate, { visitStatus: "omitido", awaitingLoan: true, skipReason: "Hoy no quiere préstamo", dayClosedAt: closedAt }),
];
const pSynced = syncPermanentRoutePlanilla(pDate, pRoutes, pClients, pLoans, [COB], pExisting, []);
const pRow = pSynced.assignments.find((r) => r.itemId === `${pDate}:CLI-P1:prestar`);
expect("Prestar atendido: la visita no desaparece", Boolean(pRow), true);
expect("Prestar atendido: queda resuelta", pRow?.visitStatus ?? null, "omitido");
expect("Prestar atendido: motivo", pRow?.skipReason ?? null, "Préstamo hecho hoy");
expect("Prestar atendido: hoja M ya cerrada → cerrada con ella", pRow?.dayClosedAt ?? null, closedAt);
expect(
  "Prestar atendido: la jornada puede sellarse",
  collectorDayVisitsFullyClosed(pSynced.assignments, COB.ref, pDate),
  true,
);
// Préstamo de días anteriores: la fila «Prestar» es fantasma, no «Préstamo hecho hoy».
const gLoans = [
  { ref: "P-G1", clientRef: "CLI-P1", client: "Flaca M", date: "20/09/2026", capital: 300_000, total: 360_000, installment: 15_000, status: "Activo" },
];
const gSynced = syncPermanentRoutePlanilla(pDate, pRoutes, pClients.slice(0, 1), gLoans, [COB], [
  visit(`${pDate}:CLI-P1:prestar`, "CLI-P1", "M", pDate, { visitStatus: "omitido", awaitingLoan: true, chargeLabel: "Prestar", skipReason: "Préstamo hecho hoy" }),
], []);
expect(
  "Préstamo viejo: sin fila «Prestar» duplicada",
  gSynced.assignments.filter((r) => r.clientRef === "CLI-P1" && r.dispatchDate === pDate && r.itemId.includes(":prestar")).length,
  0,
);
// Préstamo de hoy borrado: la fila «Préstamo hecho hoy» vuelve a Prestar pendiente (no desaparece).
const dSynced = syncPermanentRoutePlanilla(pDate, pRoutes, pClients.slice(0, 1), [
  { ...pLoans[0], status: "Eliminado" },
], [COB], [
  visit(`${pDate}:CLI-P1:prestar`, "CLI-P1", "M", pDate, { visitStatus: "omitido", awaitingLoan: true, chargeLabel: "Prestar", skipReason: "Préstamo hecho hoy" }),
], []);
const dRow = dSynced.assignments.find((r) => r.itemId === `${pDate}:CLI-P1:prestar`);
expect("Préstamo de hoy borrado: el cliente sigue en la planilla", Boolean(dRow), true);
expect("Préstamo de hoy borrado: vuelve a Prestar pendiente", dRow?.visitStatus ?? null, "pendiente");
// Préstamos a medio cargar: quien ya tiene visita de cuota hoy no recibe oferta Prestar.
const hSynced = syncPermanentRoutePlanilla(pDate, pRoutes, pClients.slice(0, 1), [], [COB], [
  visit(`${pDate}:P-G1:acum`, "CLI-P1", "M", pDate, { visitStatus: "pendiente", loanRef: "P-G1" }),
], []);
expect(
  "Préstamos sin cargar: no se ofrece Prestar a quien tiene cuota hoy",
  hSynced.assignments.some((r) => r.clientRef === "CLI-P1" && r.itemId.includes(":prestar")),
  false,
);
const albDate = "2026-10-01";
const albClients = [
  { ref: "CLI-ALB", name: "Jose", lastName: "Albornoz", route: "T", status: "Activo", routeOrder: 42 },
];
const albRoutes = [
  { ref: "RUT-T", name: "T", collectorRef: COB.ref, collector: COB.name, status: "Activa", stops: [] },
];
const albExisting = [
  visit("2026-09-30:CLI-ALB:prestar", "CLI-ALB", "T", "2026-09-30", {
    visitStatus: "omitido",
    awaitingLoan: true,
    chargeLabel: "Prestar",
    skipReason: "Préstamo hecho hoy",
  }),
  visit(`${albDate}:CLI-ALB:prestar`, "CLI-ALB", "T", albDate, {
    visitStatus: "pendiente",
    awaitingLoan: true,
    chargeLabel: "Prestar",
  }),
];
const albMissing = syncPermanentRoutePlanilla(albDate, albRoutes, albClients, [], [COB], albExisting, []);
expect(
  "Ayer se prestó: sin ficha sigue en la ruta de hoy",
  albMissing.assignments.some(
    (row) => row.dispatchDate === albDate && row.clientRef === "CLI-ALB",
  ),
  true,
);
expect(
  "Ayer se prestó: sin ficha queda en T",
  albMissing.assignments.find(
    (row) => row.dispatchDate === albDate && row.clientRef === "CLI-ALB",
  )?.clientRoute ?? "",
  "T",
);
const albLoan = {
  ref: "P-ALB",
  clientRef: "CLI-ALB",
  client: "Jose Albornoz",
  date: "2026-10-01T03:43:00.000Z",
  capital: 100_000,
  total: 120_000,
  balance: 120_000,
  installment: 5_000,
  status: "Revisar",
  schedule: [{ date: albDate, kind: "cuota", paid: 0, amount: 5_000 }],
};
const albLoaded = syncPermanentRoutePlanilla(albDate, albRoutes, albClients, [albLoan], [COB], albExisting, []);
expect(
  "Ayer se prestó: hoy sale a pagar (no Prestar)",
  albLoaded.assignments.some(
    (row) => row.dispatchDate === albDate && row.clientRef === "CLI-ALB" && row.loanRef === "P-ALB" && !String(row.itemId || "").includes(":prestar"),
  ),
  true,
);
expect(
  "Ayer se prestó: con ficha no vuelve Prestar",
  albLoaded.assignments.some(
    (row) => row.dispatchDate === albDate && row.clientRef === "CLI-ALB" && String(row.itemId || "").includes(":prestar"),
  ),
  false,
);
{
  const { restoreLoansFromOrphanDisbursements } = await import("@/lib/restore-loans-from-bank-disbursements");
  const { loanFundedByBanco, markLoanFundedByBanco, markLoanFundedByEfectivo } = await import("@/lib/nequi-pool");
  const bankDay = "2026-10-06";
  const payDay = "2026-10-07";
  const albBankClients = [
    { ref: "COD-274", name: "Jose Albornoz", lastName: "", route: "T", status: "Activo", routeOrder: 42 },
    { ref: "COD-142", name: "Martin", lastName: "", route: "N", status: "Activo", routeOrder: 1 },
    { ref: "COD-285", name: "Yeni Isolina", lastName: "", route: "T", status: "Activo", routeOrder: 10 },
  ];
  const yeniLoan = markLoanFundedByBanco({
    ref: "P-424",
    clientRef: "COD-285",
    client: "Yeni Isolina",
    date: "06/10/2026",
    capital: 1_000_000,
    installment: 30_000,
    total: 1_300_000,
    interest: 300_000,
    days: 73,
    frequency: "diario",
    status: "Revisar",
    notes: "Préstamo rápido · Diario · 2 meses\n[[fb:banco]]",
    schedule: [{ date: payDay, kind: "cuota", paid: 0, amount: 30_000 }],
  });
  const martinLoan = markLoanFundedByEfectivo({
    ref: "P-425",
    clientRef: "COD-142",
    client: "Martin",
    date: "07/10/2026",
    capital: 100_000,
    installment: 5_000,
    total: 120_000,
    status: "Revisar",
    notes: "Préstamo rápido · Diario · 1 mes\n[[fb:efectivo]]",
  });
  const bankRows = [
    {
      ref: "DSB-P-424",
      loanDisbursementRef: "DSB-P-424",
      description: "Desembolso Banco · Préstamo · P-424 · Yeni Isolina",
      thirdParty: "Yeni Isolina",
      valueDate: bankDay,
      credit: 1_000_000,
      debit: 0,
      category: "prestamo_ruta",
      accountRef: "BC",
    },
    {
      ref: "DSB-P-425",
      loanDisbursementRef: "DSB-P-425",
      description: "Desembolso Banco · Préstamo · P-425 · Jose Albornoz",
      thirdParty: "Jose Albornoz",
      valueDate: bankDay,
      credit: 1_000_000,
      debit: 0,
      category: "prestamo_ruta",
      accountRef: "BC",
    },
  ];
  const recovered = restoreLoansFromOrphanDisbursements({
    loans: [yeniLoan, martinLoan],
    movements: bankRows,
    clients: albBankClients,
  });
  const albNew = recovered.created.find((row) => row.clientRef === "COD-274");
  expect("Registro Banco: Albornoz recupera ficha (no pisa P-425 de Martín)", Boolean(albNew), true);
  expect("Registro Banco: capital de Albornoz = Haber 1.000.000", albNew?.capital ?? 0, 1_000_000);
  expect("Registro Banco: fecha del desembolso", albNew?.date?.includes("06/10") || albNew?.date === bankDay, true);
  expect("Registro Banco: Martín sigue con P-425", recovered.loans.some((row) => row.ref === "P-425" && row.clientRef === "COD-142"), true);
  expect("Registro Banco: Albornoz no se queda con P-425", albNew?.ref !== "P-425", true);
  expect("Registro Banco: cuota del lote (Yeni 30.000)", albNew?.installment ?? 0, 30_000);
  expect(
    "Registro Banco: el Haber DSB apunta a la ficha nueva",
    recovered.movements.some((row) => row.thirdParty === "Jose Albornoz" && String(row.ref).includes(albNew?.ref || "NO")),
    true,
  );
  const albToday = syncPermanentRoutePlanilla(
    payDay,
    albRoutes,
    albBankClients.filter((row) => row.ref === "COD-274"),
    recovered.loans,
    [COB],
    [
      visit("2026-10-06:COD-274:prestar", "COD-274", "T", bankDay, {
        visitStatus: "omitido",
        awaitingLoan: true,
        chargeLabel: "Prestar",
        skipReason: "Préstamo hecho hoy",
      }),
    ],
    [],
  );
  expect(
    "Registro Banco: hoy en T sale a pagar",
    albToday.assignments.some(
      (row) =>
        row.dispatchDate === payDay &&
        row.clientRef === "COD-274" &&
        row.loanRef === albNew?.ref &&
        !String(row.itemId || "").includes(":prestar"),
    ),
    true,
  );
  const albHaberRows = (rows) =>
    rows.filter(
      (row) =>
        /albornoz/i.test(`${row.thirdParty || ""} ${row.description || ""}`) &&
        (Number(row.credit) || 0) > 0,
    );
  const albHaber = (rows) => albHaberRows(rows).reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
  expect("Registro Banco: el millón ya salió (Haber)", albHaber(bankRows), 1_000_000);
  expect("Registro Banco: un solo Haber de Albornoz", albHaberRows(bankRows).length, 1);
  expect("Registro Banco: la ficha queda como Banco", loanFundedByBanco(albNew), true);
  const { syncNequiLoanDisbursementsToMovements } = await import("@/lib/bank");
  const afterLedger = syncNequiLoanDisbursementsToMovements(
    recovered.loans,
    recovered.movements,
    bankAccounts,
    albBankClients,
  );
  expect("Registro Banco: rehacer ficha no vuelve a descontar el millón", albHaber(afterLedger), 1_000_000);
  expect("Registro Banco: sigue un solo Haber de Albornoz", albHaberRows(afterLedger).length, 1);
  const ceciliaLoan = markLoanFundedByBanco({
    ref: "P-425",
    clientRef: "COD-CEC",
    client: "Cecilia",
    date: "07/10/2026",
    capital: 1_000_000,
    status: "Revisar",
  });
  const afterCecilia = syncNequiLoanDisbursementsToMovements(
    [yeniLoan, ceciliaLoan],
    bankRows,
    bankAccounts,
    [...albBankClients, { ref: "COD-CEC", name: "Cecilia", lastName: "", route: "T" }],
  );
  expect("Haber Albornoz no lo pisa otro P-425", albHaber(afterCecilia), 1_000_000);
  expect(
    "Cecilia tiene su Haber aparte",
    afterCecilia.some(
      (row) => /cecilia/i.test(`${row.thirdParty || ""}`) && (Number(row.credit) || 0) === 1_000_000,
    ),
    true,
  );
  expect(
    "José con tilde encuentra a Jose Albornoz",
    restoreLoansFromOrphanDisbursements({
      loans: [yeniLoan, martinLoan],
      movements: [{ ...bankRows[1], thirdParty: "José Albornoz" }],
      clients: [
        { ref: "COD-274", name: "Jose", lastName: "Albornoz", route: "T", status: "Activo", routeOrder: 42 },
      ],
    }).created.some((row) => row.clientRef === "COD-274" && row.capital === 1_000_000),
    true,
  );
  const poolBase = {
    payments: [],
    clients: albBankClients,
    collectors: [COB],
    collectorRefs: [COB.ref],
    dayCloses: [],
  };
  const poolBefore = digitalPoolBalances({ ...poolBase, loans: [yeniLoan, martinLoan] });
  const poolAfter = digitalPoolBalances({ ...poolBase, loans: recovered.loans });
  expect(
    "Total BANCO: el millón de Albornoz se descuenta una vez",
    poolBefore.banco - poolAfter.banco,
    1_000_000,
  );
  const { listOrphanDisbursementOutflows } = await import("@/lib/restore-loans-from-bank-disbursements");
  const { digitalPoolDayLedger } = await import("@/lib/digital-pools");
  const orphans = listOrphanDisbursementOutflows({
    loans: [yeniLoan, martinLoan],
    movements: bankRows,
    clients: albBankClients,
  });
  expect(
    "Haber huérfano: Albornoz se lista",
    orphans.some((row) => row.clientRef === "COD-274" && row.capital === 1_000_000),
    true,
  );
  expect(
    "Haber huérfano: tras ficha no se duplica",
    listOrphanDisbursementOutflows({
      loans: recovered.loans,
      movements: recovered.movements,
      clients: albBankClients,
    }).some((row) => row.clientRef === "COD-274"),
    false,
  );
  const histBefore = digitalPoolDayLedger({
    payments: [],
    loans: [yeniLoan, martinLoan],
    clients: albBankClients,
    pool: "banco",
    dateIso: bankDay,
    routeName: "T",
    movements: bankRows,
  });
  expect(
    "Historial T 06/10: Albornoz sale del Haber",
    histBefore.loans.some((row) => /albornoz/i.test(row.clientName) && row.capital === 1_000_000),
    true,
  );
  expect("Historial T 06/10: Yeni + Albornoz = 2.000.000", histBefore.outflow, 2_000_000);
  const histAfter = digitalPoolDayLedger({
    payments: [],
    loans: recovered.loans,
    clients: albBankClients,
    pool: "banco",
    dateIso: bankDay,
    routeName: "T",
    movements: recovered.movements,
  });
  expect(
    "Historial T 06/10: tras ficha Albornoz sigue una vez",
    histAfter.loans.filter((row) => /albornoz/i.test(row.clientName)).length,
    1,
  );
  expect("Historial T 06/10: no dobla el millón", histAfter.outflow, 2_000_000);
  const albFicha = markLoanFundedByBanco({
    ref: "P-430",
    clientRef: "COD-274",
    client: "Jose Albornoz",
    date: "06/10/2026",
    capital: 1_000_000,
    installment: 30_000,
    total: 1_300_000,
    interest: 300_000,
    status: "Revisar",
    notes: "[[fb:banco]]",
  });
  const histDup = digitalPoolDayLedger({
    payments: [],
    loans: [yeniLoan, martinLoan, albFicha, { ...albFicha, ref: "P-999" }],
    clients: albBankClients,
    pool: "banco",
    dateIso: bankDay,
    routeName: "T",
    movements: bankRows,
  });
  expect(
    "Prestado Banco: el mismo préstamo no se lista dos veces",
    histDup.loans.filter((row) => /albornoz/i.test(row.clientName)).length,
    1,
  );
  expect("Prestado Banco: Yeni + Albornoz una sola vez", histDup.outflow, 2_000_000);
  const albTwin = markLoanFundedByBanco({
    ...albFicha,
    ref: "P-426",
  });
  const { collapseDuplicateDigitalLoans, uniqueDigitalDisbursementLoans } = await import(
    "@/lib/restore-loans-from-bank-disbursements"
  );
  const collapsedAlb = collapseDuplicateDigitalLoans([yeniLoan, martinLoan, albFicha, albTwin]);
  expect("Ficha Albornoz: se deja el original P-426", collapsedAlb.loans.some((row) => row.ref === "P-426"), true);
  expect("Ficha Albornoz: la copia P-430 sale", collapsedAlb.removed.some((row) => row.ref === "P-430"), true);
  expect("Ficha Yeni Isolina no se toca", collapsedAlb.loans.some((row) => row.ref === yeniLoan.ref), true);
  const afterTwinHaber = syncNequiLoanDisbursementsToMovements(
    [yeniLoan, martinLoan, albFicha, albTwin],
    bankRows,
    bankAccounts,
    albBankClients,
  );
  expect(
    "Registro Banco: un solo Haber de Albornoz aunque haya dos fichas",
    albHaberRows(afterTwinHaber).length,
    1,
  );
  expect("Registro Banco: el millón de Albornoz una vez", albHaber(afterTwinHaber), 1_000_000);
  expect(
    "Registro Banco: Yeni Isolina sigue con su Haber",
    afterTwinHaber.some(
      (row) => /isolina/i.test(`${row.thirdParty || ""}`) && (Number(row.credit) || 0) === 1_000_000,
    ),
    true,
  );
  expect(
    "Registro Banco: el Haber queda en el original P-426",
    albHaberRows(afterTwinHaber).some((row) => /P-426/i.test(`${row.ref || ""} ${row.loanDisbursementRef || ""}`)),
    true,
  );
  expect(
    "Desembolso: unique deja el P- más viejo",
    uniqueDigitalDisbursementLoans([albFicha, albTwin]).map((row) => row.ref).join(","),
    "P-426",
  );
  const poolOrphan = digitalPoolBalances({
    ...poolBase,
    loans: [yeniLoan, martinLoan],
    movements: bankRows,
  });
  expect("Pool: Haber huérfano de Albornoz también resta", poolBefore.banco - poolOrphan.banco, 1_000_000);
  const poolRestoredWithMov = digitalPoolBalances({
    ...poolBase,
    loans: recovered.loans,
    movements: recovered.movements,
  });
  expect("Pool: restore + Haber no resta dos veces", poolOrphan.banco, poolRestoredWithMov.banco);
  const cashSrc = {
    collectorRef: COB.ref,
    collectorName: COB.name,
    date: bankDay,
    payments: [],
    collectors: [COB],
    assignments: [
      visit("2026-10-06:COD-274:prestar", "COD-274", "T", bankDay, {
        visitStatus: "omitido",
        awaitingLoan: true,
        chargeLabel: "Prestar",
        skipReason: "Préstamo hecho hoy",
        collectorRef: COB.ref,
      }),
    ],
    dayCloses: [],
    dayExpenseDrafts: [],
    planillaCashCloses: [],
    monthCloses: [],
  };
  const cashBase = buildDayCashLedger({
    ...cashSrc,
    loans: [yeniLoan, martinLoan],
    clients: albBankClients,
  });
  const cashWithAlb = buildDayCashLedger({
    ...cashSrc,
    loans: recovered.loans,
    clients: albBankClients,
  });
  expect("Caja T: préstamo Banco de Albornoz no sale de efectivo", cashWithAlb.dayFinal, cashBase.dayFinal);
  expect("Caja T: el millón de Albornoz no entra al libro de efectivo", cashWithAlb.t.prestamos, 0);
}
// Terminó hoy + Prestar hecho: se guarda las dos filas (el pull no revive Prestar abierta),
// la lista cuenta una sola persona.
const { visiblePlanillaAssignments } = await import("@/lib/planilla-dedupe");
const twin = [
  visit(`${pDate}:P-OLD:acum`, "CLI-P1", "M", pDate, { visitStatus: "cobrado", loanRef: "P-OLD", paymentRef: "PG-OLD" }),
  visit(`${pDate}:CLI-P1:prestar`, "CLI-P1", "M", pDate, {
    visitStatus: "omitido",
    awaitingLoan: true,
    chargeLabel: "Prestar",
    skipReason: "Préstamo hecho hoy",
  }),
];
expect("Prestar hecho hoy: las dos filas se guardan", twin.length, 2);
expect("Prestar hecho hoy: la lista no lo duplica", visiblePlanillaAssignments(twin).length, 1);
expect(
  "Prestar hecho hoy: queda la cuota, no el Prestar",
  visiblePlanillaAssignments(twin)[0]?.loanRef ?? null,
  "P-OLD",
);

// ── 15. Día 1 del mes: el cobro nunca se bloquea si el mes anterior quedó sellado por
//     el CIE- de su último día de cobro, aunque el cierre de mes falte en ese aparato.
console.log("\n— Día 1: mes sellado por CIE no bloquea el cobro —");
const { monthReviewBlock, lastCollectionDayOfPeriod } = await import("@/lib/collector-day-close");
expect("Último día de cobro de sept-2026", lastCollectionDayOfPeriod("2026-09"), "2026-09-30");
const sealedSept = [{ ref: `CIE-${COB.ref}-2026-09-30`, collectorRef: COB.ref, date: "2026-09-30", cashFloat: 11_824_000 }];
expect(
  "Día 1 con CIE del último día y sin cierre de mes: cobra",
  monthReviewBlock({ collectorRef: COB.ref, date: "2026-10-01", monthCloses: [], priorMonthHadActivity: true, dayCloses: sealedSept }),
  null,
);
expect(
  "Día 1 sin CIE ni cierre de mes: pide revisar",
  Boolean(monthReviewBlock({ collectorRef: COB.ref, date: "2026-10-01", monthCloses: [], priorMonthHadActivity: true, dayCloses: [] })),
  true,
);
expect(
  "Día 1 con CIE provisional: no cuenta como sellado",
  Boolean(monthReviewBlock({ collectorRef: COB.ref, date: "2026-10-01", monthCloses: [], priorMonthHadActivity: true, dayCloses: [{ ...sealedSept[0], provisional: true }] })),
  true,
);

// ── 16. Préstamo activo = una sola regla (`activeLoans`). Cliente libre ⇔ cero activos.
//     Préstamo borrado con cuota hoy → cliente libre, Prestar habilitado, mismo orden.
console.log("\n— Préstamo activo: regla única —");
const { activeLoans, canClientTakeNewLoan } = await import("@/lib/mock-data");
const statusLoans = ["Finalizado", " eliminado ", "CANCELADO", "Activo", "Alerta 1", "Mora", "Revisar"].map(
  (status, i) => ({ ref: `P-S${i}`, clientRef: i < 3 ? "CLI-S0" : `CLI-S${i}`, status }),
);
expect("activeLoans: limpia mayúsculas/espacios y saca finalizado/eliminado/cancelado", activeLoans(statusLoans).length, 4);
expect("Solo préstamos finalizados/borrados/cancelados: puede recibir préstamo", canClientTakeNewLoan("CLI-S0", statusLoans), true);
expect("Con préstamo en mora: no puede recibir otro", canClientTakeNewLoan("CLI-S5", statusLoans), false);

const rDate = "2026-09-30";
const rClients = [
  { ref: "CLI-R1", name: "Uno", lastName: "N", route: "M", status: "Activo", routeOrder: 1 },
  { ref: "CLI-R2", name: "Palomino", lastName: "N", route: "M", status: "Activo", routeOrder: 2 },
  { ref: "CLI-R3", name: "Tres", lastName: "N", route: "M", status: "Activo", routeOrder: 3 },
];
const rLoan = (ref, clientRef, status) => ({
  ref, clientRef, client: clientRef, date: "20/09/2026", capital: 300_000, total: 360_000, installment: 15_000, status,
});
const rDayRows = (synced) => synced.assignments.filter((r) => r.dispatchDate === rDate);
for (const prevStatus of ["pendiente", "omitido"]) {
  const rSynced = syncPermanentRoutePlanilla(
    rDate,
    pRoutes,
    rClients,
    [rLoan("P-R1", "CLI-R1", "Activo"), rLoan("P-R2", "CLI-R2", "Eliminado")],
    [COB],
    [visit(`${rDate}:P-R2:acum`, "CLI-R2", "M", rDate, { visitStatus: prevStatus, loanRef: "P-R2" })],
    [],
  );
  const rows = rDayRows(rSynced);
  const offer = rows.find((r) => r.itemId === `${rDate}:CLI-R2:prestar`);
  expect(`Borrado con cuota hoy (${prevStatus}): Prestar habilitado`, offer?.visitStatus ?? null, "pendiente");
  expect(`Borrado con cuota hoy (${prevStatus}): sin cuota del préstamo borrado`, rows.some((r) => r.loanRef === "P-R2"), false);
  const order = ["CLI-R1", "CLI-R2", "CLI-R3"].map((ref) => rows.findIndex((r) => r.clientRef === ref));
  expect(`Borrado con cuota hoy (${prevStatus}): visible y en su lugar de la ruta`, order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), true);
}
// Terminó de pagar hoy: su visita cobrada no le quita el Prestar.
const fSynced = syncPermanentRoutePlanilla(
  rDate,
  pRoutes,
  rClients.slice(0, 1),
  [{ ...rLoan("P-F1", "CLI-R1", "Finalizado"), balance: 0, paid: 360_000 }],
  [COB],
  [visit(`${rDate}:P-F1:acum`, "CLI-R1", "M", rDate, { visitStatus: "cobrado", loanRef: "P-F1", paymentRef: "PG-F1" })],
  [pay("PG-F1", "P-F1", 360_000, rDate)],
);
const fRows = rDayRows(fSynced);
expect("Terminó hoy: queda el cobro", fRows.some((r) => r.loanRef === "P-F1" && r.visitStatus === "cobrado"), true);
expect("Terminó hoy: Prestar habilitado", fRows.find((r) => r.itemId === `${rDate}:CLI-R1:prestar`)?.visitStatus ?? null, "pendiente");

// ── 17. Auto-evaluación: la planilla que arma el sistema siempre pasa la revisión;
//     cada regla detecta su inconsistencia. El motor nunca borra datos locales.
console.log("\n— Auto-evaluación del sistema —");
const { evaluateSystemHealth, QUEUE_STUCK_MS } = await import("@/lib/system-health");
const hLoans = [rLoan("P-R1", "CLI-R1", "Activo"), rLoan("P-R2", "CLI-R2", "Eliminado")];
const hBuilt = syncPermanentRoutePlanilla(rDate, pRoutes, rClients, hLoans, [COB], [], []).assignments;
const hQueueOk = { pendingTotal: 0, invalidRows: 0, pendingSinceMs: null };
const health = (over = {}) =>
  evaluateSystemHealth({
    date: rDate,
    nowMs: Date.parse(`${rDate}T15:00:00.000Z`),
    clients: rClients,
    loans: hLoans,
    routes: pRoutes,
    collectors: [COB],
    assignments: hBuilt,
    dayCloses: [],
    deletedRefs: new Set(),
    queue: hQueueOk,
    ...over,
  });
const kinds = (report) => report.issues.map((i) => i.kind).sort().join(",");
expect("Planilla armada por el sistema: sana", kinds(health()), "");
expect(
  "Prestar pendiente de cliente con préstamo activo: fantasma",
  kinds(health({ assignments: [...hBuilt, visit(`${rDate}:CLI-R1:prestar`, "CLI-R1", "M", rDate, { visitStatus: "pendiente", awaitingLoan: true })] })),
  "prestar_ghost",
);
expect(
  "Cuota sin plata de préstamo borrado: detectada",
  kinds(health({ assignments: [...hBuilt, visit(`${rDate}:P-R2:acum`, "CLI-R2", "M", rDate, { visitStatus: "pendiente", loanRef: "P-R2" })] })),
  "deleted_loan_row",
);
expect(
  "Cuota de préstamo borrado en este aparato (tombstone): detectada",
  kinds(health({
    loans: [hLoans[0]],
    deletedRefs: new Set(["P-R9"]),
    assignments: [...hBuilt, visit(`${rDate}:P-R9:acum`, "CLI-R2", "M", rDate, { visitStatus: "pendiente", loanRef: "P-R9" })],
  })),
  "deleted_loan_row",
);
const withoutR3 = hBuilt.filter((r) => r.clientRef !== "CLI-R3");
expect("Cliente libre sin su Prestar: detectado", kinds(health({ assignments: withoutR3 })), "prestar_missing");
expect(
  "Cobrador con el día sellado: no se le exige Prestar",
  kinds(health({ assignments: withoutR3, dayCloses: [{ ref: `CIE-${COB.ref}-${rDate}`, collectorRef: COB.ref, date: rDate, cashFloat: 0 }] })),
  "",
);
expect("Sin préstamos cargados: no se juzga la planilla", kinds(health({ loans: [], assignments: [] })), "");
const hNow = Date.parse(`${rDate}T15:00:00.000Z`);
expect(
  "Cola con pendientes hace más de 10 min: atascada",
  kinds(health({ queue: { pendingTotal: 3, invalidRows: 0, pendingSinceMs: hNow - QUEUE_STUCK_MS - 1 } })),
  "queue_stuck",
);
expect(
  "Cola con pendientes recientes: sana",
  kinds(health({ queue: { pendingTotal: 3, invalidRows: 0, pendingSinceMs: hNow - 60_000 } })),
  "",
);
expect("Filas de cola sin ref: detectadas", kinds(health({ queue: { ...hQueueOk, invalidRows: 2 } })), "queue_invalid_rows");
expect("Misma inconsistencia = misma firma", health({ assignments: withoutR3 }).signature, health({ assignments: withoutR3 }).signature);

// ── 18. Gasto del cobrador: nunca se pierde en silencio. La cola solo suelta lo que la nube
//     confirmó (no lo encolado durante un flush), sin keepalive y sin borrar colas por espacio.
console.log("\n— Gasto: la cola no pierde lo que no subió —");
{
  const store = new Map([["nexo-demo-virgin-ops-v1", "1"]]);
  let quotaKey = "";
  globalThis.window = {
    localStorage: {
      get length() { return store.size; },
      key: (i) => [...store.keys()][i] ?? null,
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (k === quotaKey) throw new DOMException("lleno", "QuotaExceededError");
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const Q_EXP = "nexo-demo-ops-day-expenses-queue";
  const Q_CIE = "nexo-demo-ops-day-closes-queue";
  const { mirrorDayExpenseNow, flushOpsMirrorQueues } = await import("@/lib/supabase/ops-mirror");
  const { writeDemoJson, DEMO_COLLECTOR_DAY_EXPENSES_KEY } = await import("@/lib/demo-persist");
  const gas = {
    ref: "GAS-COB-1-2026-10-01", collectorRef: "COB-1", collectorName: "Yesid", date: "2026-10-01",
    routeRef: "RUT-N", expenses: [{ id: "almuerzo", label: "Almuerzo", category: "almuerzo", amount: 9000 }],
    expensesTotal: 9000, updatedAt: "2026-10-01T20:00:00.000Z",
  };
  const queued = (key) => JSON.parse(store.get(key) ?? "[]").map((r) => r.ref).join(",");
  let keepalive = false;
  let expenseNet = "down";
  let midFlush = null;
  globalThis.fetch = async (_url, init) => {
    if (init?.keepalive) keepalive = true;
    const body = JSON.parse(init.body);
    const batch = body.kind === "batch";
    const kinds = batch ? body.items.map((item) => item.kind) : [body.kind];
    if (kinds.includes("day_close") && !midFlush) midFlush = mirrorDayExpenseNow(gas);
    if (kinds.includes("day_expense") && expenseNet === "down") throw new TypeError("Failed to fetch");
    const reply = batch ? { ok: true, results: body.items.map(() => ({ ok: true })) } : { ok: true };
    return { ok: true, status: 200, json: async () => reply };
  };

  store.set(Q_CIE, JSON.stringify([{ ref: "CIE-COB-1-2026-09-30" }]));
  await flushOpsMirrorQueues();
  expect("Gasto sin red encolado durante un flush: sigue en cola", queued(Q_EXP), gas.ref);
  expect("Envío directo sin red: avisa que no llegó", await midFlush, false);
  expect("CIE confirmado por la nube: sale de cola", queued(Q_CIE), "");

  expenseNet = "up";
  expect("Con red: el gasto confirma nube", await mirrorDayExpenseNow(gas), true);
  expect("Confirmado: sale de cola", queued(Q_EXP), "");
  expect("Envíos a la nube sin keepalive", keepalive, false);

  store.set(Q_EXP, JSON.stringify([gas]));
  quotaKey = DEMO_COLLECTOR_DAY_EXPENSES_KEY;
  expect("Aparato lleno: la escritura avisa que falló", writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, [gas]), false);
  expect("Aparato lleno: la cola de subida no se borra", queued(Q_EXP), gas.ref);
  quotaKey = "";

  const Q_CLI = "nexo-demo-client-mirror-queue";
  const { flushCatalogMirrorQueues } = await import("@/lib/supabase/catalog-mirror");
  const ficha = { ref: "COD-900", name: "Ana", route: "N", docs: [{ previewUrl: "data:image/png;base64,AAA" }] };
  const fichaNueva = { ...ficha, name: "Ana María" };
  store.set(Q_CLI, JSON.stringify([ficha]));
  globalThis.fetch = async (url, init) => {
    if (init?.keepalive) keepalive = true;
    if (String(url).includes("/api/clients/mirror")) store.set(Q_CLI, JSON.stringify([fichaNueva]));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await flushCatalogMirrorQueues();
  const cliQueue = JSON.parse(store.get(Q_CLI) ?? "[]");
  expect("Ficha editada mientras subía la anterior: sigue en cola", cliQueue.map((r) => r.name).join(","), "Ana María");
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await flushCatalogMirrorQueues();
  expect("Ficha con foto confirmada: sale de cola", queued(Q_CLI), "");
  expect("Clientes / préstamos sin keepalive", keepalive, false);
  delete globalThis.window;
}

// 19. Préstamo del supervisor con origen «Caja de la ruta»: lo asume el cobrador de la ruta
//     del cliente (renglón «Préstamo» en su GAS- → KPI, lista y caja del lado T).
//     Banco / Nequi siguen fuera de la caja. Caja cerrada → no entra.
console.log("— Préstamo del supervisor a cargo de la ruta —");
{
  const { commitRouteCashLoan, routeCashLoanLineMissing, supervisorLoanOrigin } = await import(
    "@/lib/commit-route-cash-loan"
  );
  const routes = [{ ref: "RUT-T", name: "T", collectorRef: COB.ref, collector: COB.name, status: "Activa" }];
  const supLoan = {
    ref: "P-SUP",
    clientRef: "CLI-T1",
    client: "Caro T",
    date: "26/09/2026",
    capital: 600_000,
    installment: 30_000,
    fundedBy: "efectivo",
  };
  const src = {
    clients,
    routes,
    collectors: [COB],
    assignments,
    dayCloses: [cie25],
    date: D,
    now: new Date(`${D}T15:00:00-05:00`),
  };
  expect("Origen supervisor: banco sigue banco", supervisorLoanOrigin("banco"), "banco");
  expect("Origen supervisor: caja de la ruta = efectivo", supervisorLoanOrigin("efectivo"), "efectivo");
  expect("Origen supervisor: sin origen = nequi", supervisorLoanOrigin(undefined), "nequi");
  const res = commitRouteCashLoan(supLoan, drafts, src);
  expect("Caja de la ruta: entra al cobrador de la ruta", res.ok ? res.collector.ref : res.error, COB.ref);
  const line = res.ok ? res.draft.expenses.find((r) => r.loanRef === "P-SUP") : null;
  expect("Caja de la ruta: renglón Préstamo = capital", line?.amount ?? null, 600_000);
  expect(
    "Caja de la ruta: gasto operativo del día intacto",
    res.ok ? res.draft.expenses.find((r) => r.id === "almuerzo")?.amount ?? null : null,
    20_000,
  );
  const before = buildDayCashLedger(base);
  const after = buildDayCashLedger({ ...base, loans: [...loans, supLoan], dayExpenseDrafts: res.ok ? res.drafts : drafts });
  expect("Caja de la ruta: KPI préstamo T", after.t.prestamos - before.t.prestamos, 600_000);
  expect("Caja de la ruta: caja M intacta (cliente de T)", after.mClosing, before.mClosing);
  expect("Caja de la ruta: saldo final del día baja el capital", before.dayFinal - after.dayFinal, 600_000);
  const sealed = commitRouteCashLoan(supLoan, drafts, {
    ...src,
    dayCloses: [cie25, { ...cie25, ref: `CIE-COB-0-${D}`, date: D }],
  });
  expect("Caja de la ruta: caja ya cerrada → no entra", sealed.ok, false);
  expect("Modificar a caja de la ruta: falta renglón", routeCashLoanLineMissing(supLoan, drafts, D), true);
  expect(
    "Modificar a caja de la ruta: con renglón no se duplica",
    routeCashLoanLineMissing(supLoan, res.ok ? res.drafts : drafts, D),
    false,
  );
  expect(
    "Modificar: préstamo de banco no se carga a la ruta",
    routeCashLoanLineMissing({ ...supLoan, fundedBy: "banco" }, drafts, D),
    false,
  );
  expect(
    "Modificar: préstamo de otro día no se carga hoy",
    routeCashLoanLineMissing({ ...supLoan, date: "25/09/2026" }, drafts, D),
    false,
  );
}

// 27. Anexo: el admin sube el capital de un préstamo en efectivo cuyo día ya cerró (CIE-).
//     El día sellado no se toca; la diferencia sale HOY de la caja de la ruta del cliente
//     (renglón «Anexo» → KPI Préstamo y lista). Re-editar ajusta el anexo, no lo duplica.
console.log("— Anexo de préstamo (día del desembolso cerrado) —");
{
  const { commitRouteCashLoan } = await import("@/lib/commit-route-cash-loan");
  const { buildDayExpenseDraft } = await import("@/lib/collector-day-close");
  const { dayLoanDisbursementRows } = await import("@/lib/collector-history-planilla");
  const routes = [{ ref: "RUT-T", name: "T", collectorRef: COB.ref, collector: COB.name, status: "Activa" }];
  const sealedGas = buildDayExpenseDraft({
    collectorRef: COB.ref,
    collectorName: COB.name,
    date: cie25.date,
    routeRef: "RUT-T",
    expenses: [
      { id: "prestamo", label: "Préstamo · P-ANX · Caro T", amount: 1_500_000, category: "prestamo_ruta", loanRef: "P-ANX" },
    ],
  });
  const anxLoan = {
    ref: "P-ANX",
    clientRef: "CLI-T1",
    client: "Caro T",
    date: "25/09/2026",
    capital: 1_700_000,
    installment: 45_000,
    fundedBy: "efectivo",
  };
  const src = { clients, routes, collectors: [COB], assignments, dayCloses: [cie25], date: D, now: new Date(`${D}T15:00:00-05:00`) };
  const start = [sealedGas, ...drafts];
  const first = syncCashDisbursementExpense(start, [cie25], anxLoan);
  expect("Anexo: día sellado no se toca", first.changed.length, 0);
  expect("Anexo: falta sacar hoy la diferencia", first.topUp, 200_000);
  const res = commitRouteCashLoan(anxLoan, first.drafts, src, first.topUp);
  const line = res.ok ? res.draft.expenses.find((r) => r.loanRef === "P-ANX") : null;
  expect("Anexo: entra hoy al cobrador de la ruta", res.ok ? res.draft.date : res.error, D);
  expect("Anexo: renglón = diferencia", line?.amount ?? null, 200_000);
  expect("Anexo: marcado como anexo", line?.lineKey ?? null, "anexo");
  expect(
    "Anexo: sábado sigue con el capital entregado",
    (res.ok ? res.drafts : []).find((r) => r.ref === sealedGas.ref)?.expenses[0]?.amount ?? null,
    1_500_000,
  );
  const before = buildDayCashLedger({ ...base, loans: [...loans, anxLoan] });
  const after = buildDayCashLedger({ ...base, loans: [...loans, anxLoan], dayExpenseDrafts: res.ok ? res.drafts : drafts });
  expect("Anexo: KPI préstamo T de hoy", after.t.prestamos - before.t.prestamos, 200_000);
  expect("Anexo: caja M intacta (cliente de T)", after.mClosing, before.mClosing);
  expect("Anexo: saldo final de hoy baja la diferencia", before.dayFinal - after.dayFinal, 200_000);
  const rows = dayLoanDisbursementRows(D, line ? [line] : [], [...loans, anxLoan], clients);
  expect("Anexo: la lista de Préstamos lo marca", rows[0]?.topUp ?? null, true);
  const again = syncCashDisbursementExpense(res.ok ? res.drafts : [], [cie25], { ...anxLoan, capital: 1_800_000 });
  expect("Anexo: re-editar no crea otro anexo", again.topUp, 0);
  expect(
    "Anexo: re-editar ajusta el anexo de hoy",
    again.drafts.find((r) => r.date === D)?.expenses.find((r) => r.loanRef === "P-ANX")?.amount ?? null,
    300_000,
  );
  const lower = syncCashDisbursementExpense(res.ok ? res.drafts : [], [cie25], { ...anxLoan, capital: 1_400_000 });
  expect("Anexo: bajar bajo lo entregado → aviso, sin tocar caja sellada", lower.belowSealed, 100_000);
  expect(
    "Anexo: bajar bajo lo entregado → sale el anexo de hoy",
    lower.drafts.find((r) => r.date === D)?.expenses.some((r) => r.loanRef === "P-ANX") ?? false,
    false,
  );
  const sameDay = syncCashDisbursementExpense([gasLoan], [cie25], fixedLoan);
  expect("Anexo: préstamo de un día abierto sigue igual (sin anexo)", sameDay.topUp, 0);
}

// 20. Botón Préstamos del cobrador: Efectivo (caja) + Banco / Nequi del supervisor (reporte).
//     Banco / Nequi se listan por planilla del cliente y nunca entran a la caja.
console.log("— Préstamos Banco / Nequi en la planilla del cobrador —");
{
  const { dayDigitalLoanRows, digitalLoanPoolForRoute } = await import("@/lib/day-digital-loans");
  const dl = (ref, clientRef, fundedBy, extra = {}) => ({
    ref,
    clientRef,
    client: ref,
    date: "26/09/2026",
    capital: 600_000,
    installment: 30_000,
    fundedBy,
    ...extra,
  });
  const dLoans = [
    ...loans,
    dl("P-BT", "CLI-T1", "banco"),
    dl("P-NA", "CLI-A1", "nequi"),
    dl("P-ET", "CLI-T1", "efectivo"),
    dl("P-XT", "CLI-T1", "banco", { status: "Eliminado" }),
    dl("P-OT", "CLI-T1", "banco", { date: "25/09/2026" }),
  ];
  const tRows = dayDigitalLoanRows(D, "T", dLoans, clients);
  expect("Préstamos T · Banco: solo el del día, vivo, por banco", tRows.map((r) => r.loanRef).join(","), "P-BT");
  expect("Préstamos M · Banco: no ve los de clientes de T", dayDigitalLoanRows(D, "M", dLoans, clients).length, 0);
  expect("Préstamos A · Nequi: lista el de su cliente", dayDigitalLoanRows(D, "A", dLoans, clients).map((r) => r.loanRef).join(","), "P-NA");
  const { dayPlanillaLoansWithoutPayment } = await import("@/lib/day-digital-loans");
  const unpaidT = dayPlanillaLoansWithoutPayment(D, "T", dLoans, clients, new Set());
  expect("Recaudo T: préstamos del día sin pago (banco y efectivo)", unpaidT.map((r) => r.loan.ref).sort().join(","), "P-BT,P-ET");
  expect(
    "Recaudo T: si el cliente pagó hoy, el préstamo va en su renglón (no se duplica)",
    dayPlanillaLoansWithoutPayment(D, "T", dLoans, clients, new Set(["CLI-T1"])).length,
    0,
  );
  const { buildCollectorHistoryPlanillaRows: histRows } = await import("@/lib/collector-history-planilla");
  const prestarVisit = visit("V-PT", "CLI-T1", "T", D, { kind: "prestar", visitStatus: "omitido" });
  const soloPrestamo = histRows({
    dateIso: D,
    dispatched: [prestarVisit],
    payments: [],
    loans: [...loans, dLoans.find((r) => r.ref === "P-BT")],
    clients,
  }).filter((r) => r.clientRef === "CLI-T1");
  expect("Historial: Prestar + préstamo hoy = un solo renglón «Prestado»", soloPrestamo.map((r) => r.method).join(","), "prestamo");
  const pagoYPrestamo = histRows({
    dateIso: D,
    dispatched: [visit("V-T1", "CLI-T1", "T", D, { loanRef: "P-T1" })],
    payments: payments.map((p) => ({ ...p, when: `${p.paidDate} · 10:00` })),
    loans: [...loans, dLoans.find((r) => r.ref === "P-BT")],
    clients,
  }).filter((r) => r.clientRef === "CLI-T1");
  expect("Historial: pagó y le prestaron = cuota + préstamo", pagoYPrestamo.map((r) => r.method).sort().join(","), "efectivo,prestamo");
  expect("Planilla A → bolsillo Nequi", digitalLoanPoolForRoute("A"), "nequi");
  expect("Planilla T → bolsillo Banco", digitalLoanPoolForRoute("T"), "banco");
  expect(
    "Préstamos Banco / Nequi no tocan la caja del día",
    buildDayCashLedger({ ...base, loans: [...loans, dLoans.find((r) => r.ref === "P-BT"), dLoans.find((r) => r.ref === "P-NA")] }).dayFinal,
    buildDayCashLedger(base).dayFinal,
  );
}

// 21. Punto de conexión del cobrador (INICIO): solo lectura de reportes de aparatos.
//     Verde al día · amarillo >30 min o sin internet · rojo sin subir o aparato nuevo. Taller fuera.
console.log("— Punto de conexión del cobrador —");
{
  const { collectorConnection, devicesForCollector } = await import("@/lib/collector-connection");
  const NOW = Date.parse("2026-10-01T15:00:00.000Z");
  const at = (min) => new Date(NOW - min * 60_000).toISOString();
  const dev = (deviceId, extra = {}) => ({
    deviceId,
    userRef: "USR-0",
    userName: "Cristian",
    roleName: "Cobrador",
    build: "abc1234",
    host: "prestamo-y-cobranza.vercel.app",
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile",
    lastPullAt: at(2),
    lastPullOk: true,
    lastPullError: "",
    pendingTotal: 0,
    healthIssues: 0,
    healthSummary: "",
    healthPersistent: false,
    reportedAt: at(2),
    firstSeenAt: at(60 * 24 * 10),
    ...extra,
  });
  const cols = [{ ref: "COB-1", name: "Cristian", userRef: "USR-0" }];
  const phone = dev("phone-0001");
  const taller = dev("taller-001", { host: "localhost:3000", firstSeenAt: at(5) });
  const cursor = dev("cursor-001", { userAgent: "Mozilla/5.0 Electron/37 Chrome", firstSeenAt: at(5) });
  const otro = dev("otro-0001", { userRef: "USR-9", userName: "Yesid" });
  const own = devicesForCollector("COB-1", "Cristian", cols, [phone, taller, cursor, otro]);
  expect("Conexión: el taller (localhost / Cursor) y otros usuarios no cuentan", own.map((d) => d.deviceId).join(","), "phone-0001");
  expect("Conexión: reciente y sin pendientes = verde", collectorConnection(own, NOW).level, "ok");
  expect("Conexión: >30 min sin conectarse = amarillo", collectorConnection([dev("p", { reportedAt: at(31) })], NOW).level, "warn");
  expect("Conexión: no pudo bajar la nube = amarillo", collectorConnection([dev("p", { lastPullOk: false })], NOW).level, "warn");
  expect("Conexión: cambios sin subir = rojo", collectorConnection([dev("p", { pendingTotal: 2 })], NOW).level, "alert");
  const nuevo = dev("phone-0002", { firstSeenAt: at(30) });
  const cambio = collectorConnection([phone, nuevo], NOW);
  expect("Conexión: aparato nuevo (24 h) teniendo otro anterior = rojo", `${cambio.level}:${cambio.newDevice?.deviceId}`, "alert:phone-0002");
  expect(
    "Conexión: aparato nuevo hace más de 24 h ya no alerta",
    collectorConnection([phone, dev("phone-0002", { firstSeenAt: at(60 * 25) })], NOW).level,
    "ok",
  );
  expect("Conexión: un solo aparato nunca es «nuevo»", collectorConnection([dev("p", { firstSeenAt: at(5) })], NOW).level, "ok");
  expect("Conexión: sin reportes = sin datos", collectorConnection([], NOW).level, "none");
}

// 22. Aparato sin el CIE- de ayer (caso real 03/10: Vercel 12.271.000 = CIE del 01/10,
//     taller 9.410.000 = CIE del 02/10). El Inicial de M nunca salta un día cerrado:
//     no se muestra, no se cierra, no se auto-sella y la auto-revisión lo baja de la nube.
//     Y el guardado del aparato pone el dato antes que su copia -bak (cupo justo).
console.log("— Aparato sin el CIE de ayer —");
{
  const { assertCanCloseChainedPlanilla, missingPriorDayCie } = await import("@/lib/planilla-cash-chain");
  const D1 = "2026-10-01";
  const D2 = "2026-10-02";
  const D3 = "2026-10-03";
  const cieOf = (date, cashFloat, extra = {}) => ({
    ...cie25,
    ref: `CIE-COB-0-${date}`,
    date,
    collected: 0,
    openingCash: undefined,
    cashExpected: cashFloat,
    cashDeclared: cashFloat,
    cashFloat,
    closedAt: `${date}T22:32:00.000-05:00`,
    ...extra,
  });
  const cie01 = cieOf(D1, 12_271_000);
  const cie02 = cieOf(D2, 9_410_000);
  const sealed02 = [visit("V-M9", "CLI-M1", "M", D2, { dayClosedAt: `${D2}T22:32:00.000-05:00` })];
  const withProvisional = synthesizeDayClosesFromAssignments(sealed02, [], [cie01]);
  expect("Planilla del 02 sellada sin CIE-02: queda provisional", withProvisional.find((r) => r.date === D2)?.provisional === true, true);
  expect("Falta el CIE del 02 en este aparato", missingPriorDayCie(withProvisional, [], COB.ref, D3), D2);

  const open03 = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: D3,
    records: [],
    monthCloses: [],
    dayCloses: withProvisional,
  });
  expect("Sin CIE-02: Inicial M 03 no usa el CIE-01", open03.kind === "chain" && open03.ready ? open03.opening : "no listo", "no listo");
  expect("Sin CIE-02: Inicial M 03 nunca es 12.271.000", open03.kind === "chain" && open03.opening === 12_271_000, false);
  const pceOnly = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: D3,
    records: [{ ...stalePceT25, ref: `PCE-COB-0-${D2}-M`, date: D2, routeName: "M", closingCash: 13_456_000 }],
    monthCloses: [],
    dayCloses: [cie01],
  });
  expect("PCE del 02 sin CIE-02: tampoco salta al CIE-01", pceOnly.kind === "chain" && pceOnly.ready, false);

  const guardM = assertCanCloseChainedPlanilla({ collectorRef: COB.ref, routeName: "M", date: D3, records: [], dayCloses: withProvisional });
  expect("Sin CIE-02: no deja cerrar M del 03", guardM.ok, false);
  const guardOk = assertCanCloseChainedPlanilla({ collectorRef: COB.ref, routeName: "M", date: D3, records: [], dayCloses: [cie01, cie02] });
  expect("Con CIE-02: cierre de M permitido", guardOk.ok, true);
  const guardTOpen = assertCanCloseChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "T",
    date: D3,
    records: [],
    dayCloses: [cie01, cie02],
  });
  expect("T sin PCE-M ni hoja M sellada: no cierra", guardTOpen.ok, false);
  const guardTSealed = assertCanCloseChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "T",
    date: D3,
    records: [],
    dayCloses: [cie01, cie02],
    assignments: [
      { collectorRef: COB.ref, dispatchDate: D3, clientRoute: "M", dayClosedAt: `${D3}T18:00:00.000Z` },
      { collectorRef: COB.ref, dispatchDate: D3, clientRoute: "T" },
    ],
  });
  expect("T con hoja M ya sellada: cierra (el PCE-M se rehace al sellar T)", guardTSealed.ok, true);

  const cycle03 = runOperationalDayCycle(
    {
      assignments: [...sealed02, visit("V-M10", "CLI-M1", "M", D3)],
      routes: [],
      logs: [],
      dayCloses: withProvisional,
      dayExpenseDrafts: [],
      payments: [],
      loans,
      clients,
      collectors: [COB],
      planillaCashCloses: [],
      monthCloses: [],
    },
    new Date("2026-10-04T05:10:00.000Z"),
  );
  expect("Sin CIE-02: el auto-cierre no sella el 03", cycle03.dayCloses.some((r) => r.ref === `CIE-COB-0-${D3}`), false);

  const cieHealth = evaluateSystemHealth({
    date: D3,
    nowMs: Date.parse(`${D3}T15:00:00.000Z`),
    clients: [],
    loans: [],
    routes: [],
    collectors: [COB],
    assignments: [],
    dayCloses: withProvisional,
    deletedRefs: new Set(),
    queue: hQueueOk,
  });
  expect("Auto-revisión: detecta el CIE faltante y lo repara bajando la planilla", cieHealth.issues.map((i) => `${i.kind}:${i.scope}`).join(","), "cie_missing:planilla");

  const arrived = withProvisional.map((r) => (r.ref === cie02.ref ? cie02 : r));
  const fixed03 = openingCashForChainedPlanilla({
    collectorRef: COB.ref,
    routeName: "M",
    date: D3,
    records: [],
    monthCloses: [],
    dayCloses: arrived,
  });
  expect("Llega el CIE-02 (mismo ref): Inicial M 03 = 9.410.000", fixed03.kind === "chain" && fixed03.ready ? fixed03.opening : null, 9_410_000);
  expect("Llega el CIE-02: sin inconsistencias", evaluateSystemHealth({
    date: D3,
    nowMs: Date.parse(`${D3}T15:00:00.000Z`),
    clients: [],
    loans: [],
    routes: [],
    collectors: [COB],
    assignments: [],
    dayCloses: arrived,
    deletedRefs: new Set(),
    queue: hQueueOk,
  }).ok, true);

  // Cupo justo: cabe el CIE nuevo, no cabe además la copia -bak del valor anterior.
  const { writeDemoJson, readDemoJson, DEMO_COLLECTOR_DAY_CLOSES_KEY } = await import("@/lib/demo-persist");
  const store = new Map();
  let capacity = Infinity;
  const used = () => [...store].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        const next = used() - (store.has(k) ? k.length + store.get(k).length : 0) + k.length + String(v).length;
        if (next > capacity) throw new DOMException("cupo lleno", "QuotaExceededError");
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    store.set(DEMO_COLLECTOR_DAY_CLOSES_KEY, JSON.stringify([cie01]));
    const grow = JSON.stringify([cie01, cie02]).length - JSON.stringify([cie01]).length;
    capacity = used() + grow + 10;
    const saved = writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, [cie01, cie02]);
    expect("Cupo justo: el CIE-02 se guarda (la copia -bak no compite)", saved, true);
    expect(
      "Cupo justo: el aparato queda con el CIE-02",
      readDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, []).some((r) => r.ref === cie02.ref),
      true,
    );
  } finally {
    delete globalThis.window;
  }
}

// 23. Camino limpio para la jornada: revisión de la mañana (6:00) y puesta a punto del aparato.
//     La revisión detecta hoja pasada abierta y día cerrado sin CIE-; la puesta a punto
//     solo suelta copias que la nube rehace (nunca cobros, préstamos ni el dato principal).
console.log("— Revisión de la mañana y puesta a punto —");
{
  const { evaluateMorningState } = await import("@/lib/server-morning-check");
  const M1 = "2026-10-01";
  const M2 = "2026-10-02";
  const M3 = "2026-10-03";
  const cieM1 = { ...cie25, ref: `CIE-COB-0-${M1}`, date: M1, cashFloat: 1_000_000 };
  const cieM2 = { ...cie25, ref: `CIE-COB-0-${M2}`, date: M2, cashFloat: 1_200_000 };
  const closedVisit = (id, date) => visit(id, "CLI-M1", "M", date, { dayClosedAt: `${date}T23:30:00.000-05:00` });
  const morningState = (over) => ({
    assignments: [closedVisit("V-1", M1), closedVisit("V-2", M2)],
    routes: [],
    logs: [],
    dayCloses: [cieM1, cieM2],
    dayExpenseDrafts: [],
    payments: [],
    loans,
    clients,
    collectors: [COB],
    planillaCashCloses: [],
    monthCloses: [],
    ...over,
  });
  const okOf = (items, label) => items.find((i) => i.label === label)?.ok;
  const clean = evaluateMorningState(morningState({}), M3, "2026-09-01");
  expect("Mañana: nube limpia = todo OK", clean.filter((i) => !i.ok).map((i) => i.label).join(","), "");
  const withOpen = evaluateMorningState(
    morningState({ assignments: [closedVisit("V-1", M1), closedVisit("V-2", M2), visit("V-3", "CLI-M1", "M", M2)] }),
    M3,
    "2026-09-01",
  );
  expect("Mañana: hoja de ayer abierta = revisar", okOf(withOpen, "Hojas de días anteriores cerradas"), false);
  const withoutCie = evaluateMorningState(morningState({ dayCloses: [cieM1] }), M3, "2026-09-01");
  expect("Mañana: día cerrado sin CIE = revisar", okOf(withoutCie, "Cada día cerrado tiene su CIE"), false);
  expect(
    "Mañana: días anteriores al primer CIE no se exigen",
    okOf(evaluateMorningState(morningState({ dayCloses: [cieM2] }), M3, "2026-09-01"), "Cada día cerrado tiene su CIE"),
    true,
  );

  const { compactRebuildableStorage, DEMO_PAYMENTS_KEY, DEMO_ROUTES_KEY } = await import("@/lib/demo-persist");
  const store = new Map([
    [DEMO_PAYMENTS_KEY, "[{\"ref\":\"PG-1\"}]"],
    [`${DEMO_PAYMENTS_KEY}-bak`, "[{\"ref\":\"PG-1\"}]"],
    [DEMO_ROUTES_KEY, "[{\"ref\":\"RUT-1\"}]"],
    [`${DEMO_ROUTES_KEY}-bak`, "[{\"ref\":\"RUT-1\"}]"],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    compactRebuildableStorage();
    expect("Puesta a punto: suelta la copia de rutas (la nube la rehace)", store.has(`${DEMO_ROUTES_KEY}-bak`), false);
    expect("Puesta a punto: rutas siguen en el aparato", store.has(DEMO_ROUTES_KEY), true);
    expect("Puesta a punto: cobros y su copia intactos", store.has(DEMO_PAYMENTS_KEY) && store.has(`${DEMO_PAYMENTS_KEY}-bak`), true);
  } finally {
    delete globalThis.window;
  }
}

// 24. Bajada liviana (cobros, clientes, préstamos, planilla): completa al abrir, cada 60 min,
//     al reparar y en la puesta a punto; entre medio solo lo que cambió o se creó desde el
//     corte del servidor. Una parcial nunca borra lo que no vino.
console.log("— Bajada liviana —");
{
  const { createIncrementalPull, withSinceParam, FULL_PULL_EVERY_MS } = await import("@/lib/incremental-pull");
  const { readChangedSince, changedSinceFilter, CHANGED_SINCE_OVERLAP_MS } = await import(
    "@/lib/supabase/changed-since"
  );
  const { mergePaymentsByRef } = await import("@/lib/supabase/payment-mirror");

  const pull = createIncrementalPull();
  const t0 = Date.parse("2026-10-03T11:00:00.000Z");
  expect("Bajada: sin corte = completa", pull.sinceFor(false, t0), null);
  pull.settle({ ok: true, full: true, cursor: "2026-10-03T11:00:00.000Z" }, t0);
  expect("Bajada: tras la completa = parcial con el corte del servidor", pull.sinceFor(false, t0 + 45_000), "2026-10-03T11:00:00.000Z");
  expect("Bajada: forzada (reparar / puesta a punto) = completa", pull.sinceFor(true, t0 + 45_000), null);
  expect("Bajada: a los 60 min = completa", pull.sinceFor(false, t0 + FULL_PULL_EVERY_MS), null);
  expect(
    "Bajada: a los 10 min sigue parcial (la completa de 5,6 MB trababa el celular)",
    pull.sinceFor(false, t0 + 10 * 60_000),
    "2026-10-03T11:00:00.000Z",
  );
  pull.settle({ ok: true, full: false, cursor: "2026-10-03T11:00:45.000Z" }, t0 + 45_000);
  expect("Bajada: la parcial no reinicia el reloj de la completa", pull.sinceFor(false, t0 + FULL_PULL_EVERY_MS), null);
  pull.settle({ ok: false, full: false, cursor: "2026-10-03T11:01:30.000Z" }, t0 + 90_000);
  expect("Bajada: si falla (o no entró al aparato), la próxima es completa", pull.sinceFor(false, t0 + 120_000), null);

  const req = new Request(`http://x/api/payments?since=${encodeURIComponent("2026-10-03T11:00:00.000Z")}`);
  expect(
    "Servidor: repasa el margen hacia atrás",
    readChangedSince(req),
    new Date(Date.parse("2026-10-03T11:00:00.000Z") - CHANGED_SINCE_OVERLAP_MS).toISOString(),
  );
  expect("Servidor: sin since = lista completa", readChangedSince(new Request("http://x/api/payments")), null);
  expect(
    "Servidor: atrapa el alta con hora vieja del aparato (created_at)",
    changedSinceFilter("2026-10-03T10:58:00.000Z"),
    'updated_at.gte."2026-10-03T10:58:00.000Z",created_at.gte."2026-10-03T10:58:00.000Z"',
  );
  expect("Aparato: since en la URL", withSinceParam("/api/loans", "2026-10-03T11:00:00.000Z"), "/api/loans?since=2026-10-03T11%3A00%3A00.000Z");
  expect("Aparato: completa sin since", withSinceParam("/api/loans", null), "/api/loans");

  const pg = (ref, amount) => ({
    ref,
    loan: "P-1",
    client: "Cliente",
    collector: "Cristian",
    amount,
    date: "03/10/2026",
    method: "Efectivo",
    source: "pwa",
  });
  const localPays = [pg("PG-1", 50_000), pg("PG-2", 30_000), pg("PG-3", 20_000)];
  const partial = mergePaymentsByRef(localPays, [pg("PG-4", 40_000)], []);
  expect(
    "Cobros: la parcial suma lo nuevo y conserva todo lo local",
    partial.merged.map((p) => p.ref).sort().join(","),
    "PG-1,PG-2,PG-3,PG-4",
  );
}

// 25. Informe del supervisor: Cobrado / Préstamo / Gasto por ruta = lo mismo que el libro del día.
console.log("— Informe: historial por ruta —");
{
  const { informeRouteHistory } = await import("@/lib/informe-route-days");
  const { routeCollectedByMethod } = await import("@/lib/day-cash-ledger");
  const hist = informeRouteHistory(baseT, [COB.ref], D, D);
  const dayOf = (kind) => hist[kind].days.find((row) => row.date === D);
  const collected = (route) => {
    const by = routeCollectedByMethod(baseT, route);
    return by.efectivo + by.banco + by.nequi;
  };
  expect("Informe · Préstamo M = libro M", dayOf("prestamo")?.M ?? null, ledgerT.m.prestamos);
  expect("Informe · Préstamo T = libro T", dayOf("prestamo")?.T ?? null, ledgerT.t.prestamos);
  expect("Informe · Gasto M = libro M (sin capital prestado)", dayOf("gasto")?.M ?? null, ledgerT.m.gastos);
  expect("Informe · Gasto T = libro T", dayOf("gasto")?.T ?? null, ledgerT.t.gastos);
  expect("Informe · Cobrado M = cobros de clientes de M", dayOf("cobrado")?.M ?? null, collected("M"));
  expect("Informe · Cobrado T = cobros de clientes de T", dayOf("cobrado")?.T ?? null, collected("T"));
  expect(
    "Informe · Total del día = T + M + N",
    dayOf("prestamo")?.total ?? null,
    (dayOf("prestamo")?.T ?? 0) + (dayOf("prestamo")?.M ?? 0) + (dayOf("prestamo")?.N ?? 0),
  );
  expect("Informe · Total del botón = suma de los días", hist.gasto.total, hist.gasto.days.reduce((s, r) => s + r.total, 0));
  const repeated = informeRouteHistory(baseT, [COB.ref, COB.ref, COB.ref], D, D);
  expect(
    "Informe · cobrador con varias rutas (M, T, A) se cuenta una vez",
    repeated.prestamo.days.find((row) => row.date === D)?.T ?? null,
    ledgerT.t.prestamos,
  );
}

// 26. Cupo del aparato: planilla y rutas del día viven en IndexedDB (crecen ~190 KB/día y
//     llenaban los ~5 MB de localStorage: el supervisor dejó de guardar lo que bajaba).
//     Con el cupo lleno se sueltan también las copias -bak del catálogo; dato y colas siguen.
console.log("— Cupo del aparato —");
{
  const {
    writeDemoJson,
    readDemoJson,
    DEMO_PAYMENTS_KEY,
    DEMO_LOANS_KEY,
    DEMO_DAILY_ASSIGNMENTS_KEY,
    DEMO_ROUTES_KEY,
  } = await import("@/lib/demo-persist");
  const big = await import("@/lib/big-demo-store");

  const store = new Map();
  let cap = Infinity;
  const used = () => [...store.values()].reduce((sum, v) => sum + v.length, 0);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      const next = String(v);
      if (used() - (store.get(k)?.length ?? 0) + next.length > cap) {
        throw new DOMException("full", "QuotaExceededError");
      }
      store.set(k, next);
    },
    removeItem: (k) => store.delete(k),
  };

  const idb = new Map();
  const fakeIndexedDB = {
    open() {
      const req = {};
      setTimeout(() => {
        const fresh = idb.size === 0;
        const db = {
          objectStoreNames: { contains: () => !fresh },
          createObjectStore: () => undefined,
          transaction: () => {
            const tx = {};
            let open = 0;
            const op = (fn) => {
              const r = {};
              open += 1;
              setTimeout(() => {
                r.result = fn();
                r.onsuccess?.();
                open -= 1;
                if (open === 0) setTimeout(() => tx.oncomplete?.());
              });
              return r;
            };
            tx.objectStore = () => ({
              get: (k) => op(() => idb.get(k)),
              put: (v, k) => op(() => void idb.set(k, v)),
              delete: (k) => op(() => void idb.delete(k)),
            });
            return tx;
          },
          close: () => undefined,
        };
        if (fresh) idb.set("__init", "1");
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  const prevBroadcast = globalThis.BroadcastChannel;
  globalThis.window = { localStorage, dispatchEvent: () => true };
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.BroadcastChannel = undefined;
  try {
    const catalogBak = JSON.stringify([{ ref: "PG-0", n: "x".repeat(60) }]);
    store.set(DEMO_PAYMENTS_KEY, JSON.stringify([{ ref: "PG-1" }]));
    store.set(`${DEMO_PAYMENTS_KEY}-bak`, catalogBak);
    store.set(`${DEMO_LOANS_KEY}-bak`, catalogBak);
    store.set("nexo-demo-payment-mirror-queue", JSON.stringify([{ ref: "Q" }]));
    cap = used();
    const nextPayments = [{ ref: "PG-1" }, { ref: "PG-2", n: "y".repeat(40) }];
    expect("Cupo lleno: el cobro bajado entra (suelta copias -bak del catálogo)", writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments), true);
    expect("Cupo lleno: el cobro quedó en su clave", store.get(DEMO_PAYMENTS_KEY), JSON.stringify(nextPayments));
    expect("Cupo lleno: la cola de subida no se toca", store.has("nexo-demo-payment-mirror-queue"), true);

    cap = Infinity;
    store.clear();
    const planilla = JSON.stringify([{ id: "V-1", dispatchDate: "2026-10-03" }]);
    store.set(DEMO_DAILY_ASSIGNMENTS_KEY, planilla);
    store.set(DEMO_ROUTES_KEY, JSON.stringify([{ ref: "RUT-1" }]));
    store.set(`${DEMO_ROUTES_KEY}-bak`, JSON.stringify([{ ref: "RUT-1" }]));
    store.set(DEMO_PAYMENTS_KEY, "[]");
    store.set(`${DEMO_PAYMENTS_KEY}-bak`, JSON.stringify([{ ref: "PG-9" }]));
    store.set("nexo-demo-payment-mirror-queue", JSON.stringify([{ ref: "Q" }]));
    store.set("nexo-admin-session", "{}");
    await big.hydrateBigDemoStore();
    expect("IndexedDB: almacén activo tras el arranque", big.bigDemoStoreActive(), true);
    expect(
      "IndexedDB: datos y sus copias salen de localStorage",
      [DEMO_DAILY_ASSIGNMENTS_KEY, DEMO_ROUTES_KEY, `${DEMO_ROUTES_KEY}-bak`, DEMO_PAYMENTS_KEY, `${DEMO_PAYMENTS_KEY}-bak`].some((k) =>
        store.has(k),
      ),
      false,
    );
    expect(
      "IndexedDB: colas de subida y sesión siguen en localStorage",
      store.has("nexo-demo-payment-mirror-queue") && store.has("nexo-admin-session"),
      true,
    );
    expect("IndexedDB: la copia -bak viajó (cobro recuperable)", idb.get(`${DEMO_PAYMENTS_KEY}-bak`), JSON.stringify([{ ref: "PG-9" }]));
    expect("IndexedDB: un [] sigue leyendo la copia -bak", readDemoJson(DEMO_PAYMENTS_KEY, []).length, 1);
    expect("IndexedDB: la planilla se sigue leyendo igual", readDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, []).length, 1);
    expect("IndexedDB: localStorage queda casi vacío", used() < 200, true);
    const nextPlanilla = [{ id: "V-1" }, { id: "V-2" }];
    expect("IndexedDB: guardar planilla responde OK", writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, nextPlanilla), true);
    await big.flushBigDemoStore();
    expect("IndexedDB: lo guardado quedó en IndexedDB", idb.get(DEMO_DAILY_ASSIGNMENTS_KEY), JSON.stringify(nextPlanilla));
    expect("IndexedDB: localStorage no vuelve a recibir la planilla", store.has(DEMO_DAILY_ASSIGNMENTS_KEY), false);
  } finally {
    delete globalThis.window;
    delete globalThis.indexedDB;
    globalThis.BroadcastChannel = prevBroadcast;
  }

  const { deviceStorageAlerts, DEVICE_STORAGE_WARN_KB } = await import("@/lib/device-storage-alerts");
  const nowMs = Date.parse("2026-10-03T18:00:00Z");
  const device = (over) => ({
    deviceId: "dev-12345678",
    userName: "Carlos",
    roleName: "Supervisor",
    host: "prestamo-y-cobranza.vercel.app",
    build: "x",
    lastPullOk: true,
    lastPullError: "",
    storageUsedKb: 1000,
    reportedAt: "2026-10-03T17:40:00Z",
    ...over,
  });
  expect(
    "Alarma: aparato que no guarda lo que baja",
    deviceStorageAlerts([device({ lastPullOk: false, lastPullError: "cobros: sin espacio en el aparato: cobros" })], nowMs).length,
    1,
  );
  expect("Alarma: almacenamiento al 70 %", deviceStorageAlerts([device({ storageUsedKb: DEVICE_STORAGE_WARN_KB })], nowMs).length, 1);
  expect("Alarma: aparato sano no alerta", deviceStorageAlerts([device({})], nowMs).length, 0);
  expect("Alarma: sin internet no es falta de espacio", deviceStorageAlerts([device({ lastPullOk: false, lastPullError: "fetch failed" })], nowMs).length, 0);
  expect(
    "Alarma: aparato que no se usa hace días no cuenta",
    deviceStorageAlerts([device({ lastPullOk: false, lastPullError: "sin espacio", reportedAt: "2026-09-30T10:00:00Z" })], nowMs).length,
    0,
  );
}

{
  console.log("\n— 27. Bajada completa: la base corta en 1.000 filas, nada se lee con .limit() mayor —");
  const { readFileSync } = await import("node:fs");
  const mirrors = ["payment-mirror.ts", "catalog-mirror.ts", "ops-mirror.ts"];
  for (const file of mirrors) {
    const source = readFileSync(new URL(`../lib/supabase/${file}`, import.meta.url), "utf8");
    const big = [...source.matchAll(/\.limit\((\d+)\)/g)].filter((m) => Number(m[1]) > 1000).length;
    expect(`Bajada completa sin .limit() > 1000 en ${file}`, big, 0);
  }

  const { fetchAllRows } = await import("@/lib/supabase/changed-since");
  const table = Array.from({ length: 2398 }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}`, ref: `PG-${i}` }));
  const fakeClient = {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: (from, to) => Promise.resolve({ data: table.slice(from, Math.min(to + 1, from + 1000)), error: null }),
      };
      return q;
    },
  };
  const all = await fetchAllRows(fakeClient, "payments", "*");
  expect("Bajada completa trae las 2.398 filas (no las primeras 1.000)", all.ok ? all.rows.length : -1, 2398);
}

{
  console.log("\n— 28. Cobrador: solo el día; el historial no se reenvía —");
  const { readFileSync } = await import("node:fs");
  const paySrc = readFileSync(new URL("../lib/supabase/payment-mirror.ts", import.meta.url), "utf8");
  expect(
    "Reconcile de cobros = cola, no historial",
    paySrc.includes("flushPaymentMirrorQueue") && !paySrc.includes("for (const payment of missing)"),
    true,
  );
  const appSrc = readFileSync(new URL("../components/CollectorMobileApp.tsx", import.meta.url), "utf8");
  expect("App cobrador no baja la lista entera al abrir", appSrc.includes("loadLivePaymentRows"), false);
  expect("App cobrador pide el historial al tocarlo", appSrc.includes("pullCollectorHistoryDay"), true);

  const { syncCollectorLiveLoan } = await import("@/lib/collector-live-window");
  const loan = {
    ref: "P-1",
    clientRef: "CLI-1",
    client: "Ana",
    date: "01/09/2026",
    due: "06/10/2026",
    capital: 600000,
    paid: 500000,
    balance: 100000,
    total: 600000,
    installment: 20000,
    status: "Activo",
    kind: "ok",
    updatedAt: "2026-10-06T10:00:00.000Z",
  };
  const live = syncCollectorLiveLoan(
    loan,
    [
      {
        ref: "PG-new",
        loanRef: "P-1",
        when: "06/10/2026",
        paidDate: "2026-10-06",
        client: "Ana",
        collector: "Yesid",
        amount: 20000,
        type: "Cuota",
        kind: "ok",
        updatedAt: "2026-10-06T18:00:00.000Z",
      },
    ],
    "2026-10-06",
  );
  expect("Saldo cobrador = ficha + cobro de hoy que aún no está en la ficha", live.paid, 520000);
  expect("Saldo restante tras el cobro de hoy", live.balance, 80000);
}

{
  const { readFileSync } = await import("node:fs");
  const syncSrc = readFileSync(new URL("../lib/use-operational-demo-sync.ts", import.meta.url), "utf8");
  const targeted = syncSrc.slice(syncSrc.indexOf("const runTargetedPull"));
  expect(
    "Supervisor: el timbre baja los cobros de hoy (no espera since)",
    targeted.includes("mergePaymentsWindowIntoDemo"),
    true,
  );
  expect(
    "Supervisor: el cobro en vivo no espera el flush de este aparato",
    targeted.includes("await runMirrorFlush()"),
    false,
  );
  expect(
    "Cobrador: el timbre de su cobro no rehace T",
    targeted.includes("isCollectorLiveDevice()") && targeted.includes("return"),
    true,
  );
}

{
  console.log("— Préstamo efectivo único (Marlin ×3) y Hiania 800 no es Banco —");
  const { dayLoanDisbursementRows, dayLoanDisbursementTotal } = await import(
    "@/lib/collector-history-planilla"
  );
  const { dayDigitalLoanRows } = await import("@/lib/day-digital-loans");
  const { collapseDuplicateDigitalLoans, existingDigitalDisbursementTwin } = await import(
    "@/lib/restore-loans-from-bank-disbursements"
  );
  const { markLoanFundedByEfectivo } = await import("@/lib/nequi-pool");
  const { syncCashLoanDisbursementsToMovements, syncNequiLoanDisbursementsToMovements } =
    await import("@/lib/bank");
  const { syncBankLedger } = await import("@/lib/bank-ledger-sync");
  const { digitalPoolBalances } = await import("@/lib/digital-pools");
  const nDate = "2026-10-07";
  const hiania = { ref: "COD-HIA", name: "Hiania", lastName: "", route: "N", status: "Activo" };
  const marlin = { ref: "COD-MAR", name: "Marlin", lastName: "", route: "N", status: "Activo" };
  const nClients = [hiania, marlin];
  const pHia = markLoanFundedByEfectivo({
    ref: "P-800",
    clientRef: hiania.ref,
    client: "Hiania",
    date: "07/10/2026",
    capital: 800_000,
    installment: 25_000,
    status: "Activo",
    fundedBy: "efectivo",
  });
  const pMar1 = markLoanFundedByEfectivo({
    ref: "P-101",
    clientRef: marlin.ref,
    client: "Marlin",
    date: "07/10/2026",
    capital: 100_000,
    installment: 5_000,
    status: "Activo",
    fundedBy: "efectivo",
  });
  const nLoans = [pHia, pMar1, { ...pMar1, ref: "P-102" }, { ...pMar1, ref: "P-103" }];
  const nExpenses = nLoans.map((loan) => ({
    id: "prestamo",
    label: `Préstamo · ${loan.ref} · ${loan.client}`,
    amount: loan.capital,
    category: "prestamo_ruta",
    loanRef: loan.ref,
  }));
  const cobN = { ref: "COB-Y", name: "Yesid" };
  const rows = dayLoanDisbursementRows(nDate, nExpenses, nLoans, nClients, {
    collectorRef: cobN.ref,
    assignments: [
      { clientRef: hiania.ref, collectorRef: cobN.ref, dispatchDate: nDate, route: "N" },
      { clientRef: marlin.ref, collectorRef: cobN.ref, dispatchDate: nDate, route: "N" },
    ],
  });
  expect("Préstamos N: Marlin una sola vez", rows.filter((row) => row.clientRef === marlin.ref).length, 1);
  expect("Préstamos N: Hiania una sola vez", rows.filter((row) => row.clientRef === hiania.ref).length, 1);
  expect("Préstamos N: efectivo = 800 + 100", dayLoanDisbursementTotal(rows), 900_000);
  expect(
    "Préstamos N: original Marlin es el P- más viejo",
    rows.find((row) => row.clientRef === marlin.ref)?.loanRef,
    "P-101",
  );
  expect("Banco N: Hiania 800 no entra al pool (es efectivo)", dayDigitalLoanRows(nDate, "N", nLoans, nClients).length, 0);
  const dsbHaber = syncNequiLoanDisbursementsToMovements(nLoans, [], bankAccounts, nClients);
  expect("DSB Banco/Nequi: el efectivo no arma DSB", dsbHaber.length, 0);
  const reg = syncCashLoanDisbursementsToMovements(nLoans, [], bankAccounts);
  expect(
    "Registro sistema: Hiania 800 en Haber azul",
    reg.filter(
      (row) =>
        /hiania/i.test(`${row.thirdParty || ""}`) &&
        row.category === "prestamo_ruta" &&
        (Number(row.credit) || 0) === 800_000,
    ).length,
    1,
  );
  expect(
    "Registro sistema: Marlin 100 una sola vez",
    reg.filter((row) => /marlin/i.test(`${row.thirdParty || ""}`) && (Number(row.credit) || 0) === 100_000)
      .length,
    1,
  );
  const ledger = syncBankLedger({
    payments: [],
    movements: [],
    accounts: bankAccounts,
    miscPayments: [],
    dayExpenseDrafts: [
      {
        ref: `GAS-${cobN.ref}-${nDate}`,
        collectorRef: cobN.ref,
        collectorName: cobN.name,
        date: nDate,
        expenses: [{ id: "gasolina", label: "Gasolina", amount: 10_000, category: "gasolina" }],
      },
    ],
    dayCloses: [],
    loans: nLoans,
    clients: nClients,
  });
  expect(
    "Registro sistema: gasolina de Yesid sigue",
    ledger.some((row) => row.category === "gasolina" && (Number(row.credit) || 0) === 10_000),
    true,
  );
  expect(
    "Registro sistema: préstamo + gasolina en la misma cuenta",
    ledger.filter((row) => row.category === "prestamo_ruta" || row.category === "gasolina").every(
      (row) => row.accountRef === ledger.find((item) => item.category === "gasolina")?.accountRef,
    ),
    true,
  );
  const poolN = digitalPoolBalances({
    payments: [],
    loans: nLoans,
    clients: nClients,
    collectors: [cobN],
    collectorRefs: [cobN.ref],
    dayCloses: [],
    movements: ledger,
  });
  expect("Pool Banco N: el efectivo no resta el acumulado", poolN.banco, 0);
  const collapsed = collapseDuplicateDigitalLoans(nLoans);
  expect("Ficha Marlin: se deja el original P-101", collapsed.loans.some((row) => row.ref === "P-101"), true);
  expect(
    "Hydrate Banco/Nequi: no tumba el efectivo de Marlin (el cobrador no se cuelga)",
    collapsed.removed.filter((row) => row.clientRef === marlin.ref).length,
    0,
  );
  expect("Ficha Hiania no se toca", collapsed.loans.some((row) => row.ref === "P-800"), true);
  expect(
    "Alta: no se duplica el mismo efectivo",
    existingDigitalDisbursementTwin(nLoans, marlin.ref, nDate, 100_000)?.ref,
    "P-101",
  );
}

{
  console.log("— Banco N sin Diego fantasma; Banco M solo Carlos Cerveza 500 —");
  const { listOrphanDisbursementOutflows, restoreLoansFromOrphanDisbursements } = await import(
    "@/lib/restore-loans-from-bank-disbursements"
  );
  const { markLoanFundedByEfectivo, markLoanFundedByBanco } = await import("@/lib/nequi-pool");
  const { syncBankLedger } = await import("@/lib/bank-ledger-sync");
  const { digitalPoolBalances } = await import("@/lib/digital-pools");
  const diegoN = { ref: "COD-184", name: "Diego", lastName: "", route: "N", status: "Activo" };
  const diegoA = { ref: "COD-260", name: "Diego", lastName: "", route: "A", status: "Activo" };
  const rachi = { ref: "COD-RAC", name: "Rachi", lastName: "", route: "M", status: "Activo" };
  const carlos = { ref: "COD-87", name: "Carlos Cerveza", lastName: "", route: "M", status: "Activo" };
  const clients = [diegoN, diegoA, rachi, carlos];
  const p399 = markLoanFundedByEfectivo({
    ref: "P-399",
    clientRef: diegoA.ref,
    client: "Diego",
    date: "02/10/2026",
    capital: 600_000,
    installment: 30_000,
    status: "Revisar",
    fundedBy: "efectivo",
  });
  const p375 = markLoanFundedByEfectivo({
    ref: "P-375",
    clientRef: rachi.ref,
    client: "Rachi",
    date: "01/10/2026",
    capital: 200_000,
    installment: 10_000,
    status: "Revisar",
    fundedBy: "efectivo",
  });
  const p408 = markLoanFundedByBanco({
    ref: "P-408",
    clientRef: carlos.ref,
    client: "Carlos Cerveza",
    date: "03/10/2026",
    capital: 500_000,
    installment: 25_000,
    status: "Revisar",
    fundedBy: "banco",
  });
  const loans = [p399, p375, p408];
  const cob = { ref: "COB-C", name: "Diego" };
  const expenseFor = (loan, date) => ({
    ref: `GAS-${cob.ref}-${date}`,
    collectorRef: cob.ref,
    collectorName: cob.name,
    date,
    expenses: [
      {
        id: "prestamo",
        label: `Préstamo · ${loan.ref} · ${loan.client}`,
        amount: loan.capital,
        category: "prestamo_ruta",
        loanRef: loan.ref,
      },
    ],
  });
  const ledger = syncBankLedger({
    payments: [],
    movements: [],
    accounts: bankAccounts,
    miscPayments: [],
    dayExpenseDrafts: [expenseFor(p375, "2026-10-01"), expenseFor(p399, "2026-10-02")],
    dayCloses: [],
    loans,
    clients,
  });
  expect(
    "Huérfanos: el efectivo (GASL / CSH) no es desembolso Banco",
    listOrphanDisbursementOutflows({ loans, movements: ledger, clients }).length,
    0,
  );
  expect(
    "Restore: el efectivo no crea fichas Banco",
    restoreLoansFromOrphanDisbursements({ loans, movements: ledger, clients }).created.length,
    0,
  );
  const ambiguous = [
    {
      ref: "DSB-P-999",
      loanDisbursementRef: "DSB-P-999",
      accountRef: ledger[0]?.accountRef || "",
      period: "2026-10",
      description: "Desembolso Banco · Préstamo · P-999 · Diego",
      valueDate: "2026-10-02",
      opDate: "2026-10-02",
      thirdParty: "Diego",
      debit: 0,
      credit: 600_000,
      category: "prestamo_ruta",
    },
  ];
  expect(
    "Huérfanos: «Diego» en N y en A no se adivina",
    listOrphanDisbursementOutflows({ loans, movements: ambiguous, clients }).length,
    0,
  );
  const pools = digitalPoolBalances({
    payments: [],
    loans,
    clients,
    collectors: [cob],
    collectorRefs: [cob.ref],
    dayCloses: [],
    movements: ledger,
  });
  expect("Banco: solo sale Carlos Cerveza 500 (M)", pools.banco, -500_000);
}

{
  console.log("— Préstamo del cobrador: solo sube la visita que cambió —");
  const { assignmentsChangedFrom, collectorQueueKeepsAssignment } = await import(
    "@/lib/supabase/ops-mirror"
  );
  const todayQ = "2026-10-07";
  expect(
    "Cola del cobrador: hoy y ayer suben",
    collectorQueueKeepsAssignment({ ref: "2026-10-07::A" }, todayQ) &&
      collectorQueueKeepsAssignment({ dispatchDate: "2026-10-06", ref: "x" }, todayQ),
    true,
  );
  expect(
    "Cola del cobrador: 23/09–02/10 (historia) no se reenvía (Yesid trabado)",
    ["2026-09-23", "2026-09-30", "2026-10-02"].some((day) =>
      collectorQueueKeepsAssignment({ ref: `${day}::A` }, todayQ),
    ),
    false,
  );
  const { readFileSync } = await import("node:fs");
  const opsMirrorSrc = readFileSync(new URL("../lib/supabase/ops-mirror.ts", import.meta.url), "utf8");
  expect(
    "Servidor: día pasado cerrado no se reescribe con copia de aparato (historia sagrada)",
    opsMirrorSrc.includes('reason: "historia_sellada"') &&
      opsMirrorSrc.includes("pruneCollectorHistoryQueue();"),
    true,
  );
  const visit = (itemId, dispatchDate, extra = {}) => ({
    itemId,
    dispatchDate,
    clientRef: `COD-${itemId}`,
    collectorRef: "COB-0",
    amountDue: 10_000,
    visitStatus: "pendiente",
    dispatched: true,
    ...extra,
  });
  const prev = [
    ...Array.from({ length: 200 }, (_, index) => visit(`V${index}`, "2026-10-06", { visitStatus: "cobrado", dayClosedAt: "2026-10-06T23:30:00Z" })),
    ...Array.from({ length: 230 }, (_, index) => visit(`H${index}`, "2026-10-07")),
    visit("PRESTAR-1", "2026-10-07", { kind: "prestar", amountDue: 0 }),
  ];
  const next = [
    ...prev.filter((row) => row.itemId !== "PRESTAR-1"),
    visit("PRESTAR-1", "2026-10-07", { kind: "prestar", amountDue: 0, visitStatus: "omitido", skipReason: "Préstamo hecho hoy" }),
    visit("CUOTA-P-999", "2026-10-07", { loanRef: "P-999" }),
  ];
  const changed = assignmentsChangedFrom(prev, next);
  expect("Préstamo: sube 2 visitas (Prestar atendido + cuota nueva), no 432", changed.length, 2);
  expect(
    "Préstamo: el día de ayer (sellado) no se reenvía",
    changed.some((row) => row.dispatchDate === "2026-10-06"),
    false,
  );
}

{
  console.log("\n— P- chocado entre aparatos: Bader no borra a Dary (M 07/10) —");
  const { appendCashDisbursementExpense: appendLoanLine, cashLineIsLoanOf } = await import(
    "@/lib/collector-day-close"
  );
  const base = {
    collectorRef: "COB-0",
    collectorName: "Edgar",
    date: "2026-10-07",
    routeRef: "M",
  };
  let drafts = appendLoanLine([], { ...base, loan: { ref: "P-434", client: "Dary Amor", capital: 900_000 } });
  drafts = appendLoanLine(drafts, { ...base, loan: { ref: "P-434", client: "Bader", capital: 1_000_000 } });
  const lines = drafts[0]?.expenses ?? [];
  expect(
    "Mismo P-434 de otro cliente: quedan Dary 900.000 y Bader 1.000.000",
    lines.map((row) => `${row.label}=${row.amount}`).sort().join(" | "),
    "Préstamo · P-434 · Bader=1000000 | Préstamo · P-434 · Dary Amor=900000",
  );
  drafts = appendLoanLine(drafts, { ...base, loan: { ref: "P-434", client: "Dary Amor", capital: 900_000 } });
  expect("Mismo préstamo otra vez: no se duplica", drafts[0]?.expenses.length, 2);
  expect(
    "Renombre P-434 → P-442 de Bader no toca a Dary",
    cashLineIsLoanOf({ loanRef: "P-434", label: "Préstamo · P-434 · Dary Amor" }, "P-434", "Bader"),
    false,
  );
  const { dayLoanDisbursementRows: loanRowsM, dayLoanDisbursementTotal: loanTotalM } = await import(
    "@/lib/collector-history-planilla"
  );
  const { isLiveCashDay } = await import("@/lib/collector-day-close");
  const mClient = (ref, name) => ({ ref, name, lastName: "", route: "M", status: "Activo" });
  const mClients = [
    mClient("COD-CEC", "Cecilia"),
    mClient("COD-62", "Dary Amor"),
    mClient("COD-57", "Enrique"),
    mClient("COD-65", "Celina"),
    mClient("COD-37", "Bader"),
  ];
  const mLoan = (ref, clientRef, client, capital) => ({
    ref,
    clientRef,
    client,
    date: "07/10/2026",
    capital,
    installment: 45_000,
    status: "Activo",
    fundedBy: "efectivo",
  });
  const mLoans = [
    mLoan("P-425", "COD-CEC", "Cecilia", 1_000_000),
    mLoan("P-434", "COD-62", "Dary Amor", 900_000),
    mLoan("P-435", "COD-57", "Enrique", 300_000),
    mLoan("P-437", "COD-65", "Celina", 2_000_000),
    mLoan("P-442", "COD-37", "Bader", 1_000_000),
  ];
  const brokenLines = [
    { id: "prestamo", label: "Préstamo · P-425 · Cecilia", amount: 1_000_000, loanRef: "P-425", category: "prestamo_ruta" },
    { id: "prestamo", label: "Préstamo · P-434 · Bader", amount: 1_000_000, loanRef: "P-434", category: "prestamo_ruta" },
    { id: "prestamo", label: "Préstamo · P-443 · Celina", amount: 2_000_000, loanRef: "P-443", category: "prestamo_ruta" },
  ];
  const mScope = {
    collectorRef: "COB-0",
    assignments: mClients.map((row) => ({
      clientRef: row.ref,
      collectorRef: "COB-0",
      dispatchDate: "2026-10-07",
      route: "M",
    })),
  };
  const liveRows = loanRowsM("2026-10-07", brokenLines, mLoans, mClients, { ...mScope, liveDay: true });
  expect("Día abierto: Préstamos M = fichas (5.200.000), no el renglón dañado", loanTotalM(liveRows), 5_200_000);
  expect(
    "Día abierto: Dary sale con lo de su ficha (900.000)",
    liveRows.find((row) => row.clientRef === "COD-62")?.capital ?? null,
    900_000,
  );
  const sealedRows = loanRowsM("2026-10-07", brokenLines, mLoans, mClients, mScope);
  expect(
    "Día sellado: el renglón guardado es historia y no se recalcula",
    sealedRows.find((row) => row.loanRef === "P-434")?.capital ?? null,
    1_000_000,
  );
  const cieM = { ref: "CIE-COB-0-2026-10-07", collectorRef: "COB-0", date: "2026-10-07" };
  expect(
    "Día vivo = hoy sin CIE- sellado; con CIE- o ayer, no",
    [
      isLiveCashDay("COB-0", "2026-10-07", [], "2026-10-07"),
      isLiveCashDay("COB-0", "2026-10-07", [cieM], "2026-10-07"),
      isLiveCashDay("COB-0", "2026-10-07", [{ ...cieM, provisional: true }], "2026-10-07"),
      isLiveCashDay("COB-0", "2026-10-06", [], "2026-10-07"),
    ].join(","),
    "true,false,true,false",
  );
  const { renameLoanRefInState } = await import("@/lib/supabase/catalog-mirror");
  const gasLine = (ref, client, amount) => ({
    id: "prestamo",
    label: `Préstamo · ${ref} · ${client}`,
    amount,
    loanRef: ref,
    category: "prestamo_ruta",
  });
  const gasM = {
    ref: "GAS-COB-0-2026-10-07",
    collectorRef: "COB-0",
    collectorName: "Edgar",
    date: "2026-10-07",
    routeRef: "RUT-1",
    expenses: [gasLine("P-434", "Dary Amor", 900_000), gasLine("P-434", "Bader", 1_000_000)],
    expensesTotal: 1_900_000,
  };
  const visit = (loanRef, clientRef, extra = {}) => ({
    itemId: `2026-10-08:${loanRef}`,
    dispatchDate: "2026-10-08",
    loanRef,
    clientRef,
    collectorRef: "COB-0",
    ...extra,
  });
  const clash = renameLoanRefInState(
    {
      loans: [mLoan("P-434", "COD-37", "Bader", 1_000_000)],
      loanQueue: [],
      assignments: [visit("P-434", "COD-62"), visit("P-434", "COD-37")],
      drafts: [gasM],
    },
    { ref: "P-434", clientRef: "COD-37", client: "Bader" },
    "P-442",
    "2026-10-07",
  );
  expect(
    "Choque P-434: Bader pasa a P-442 (ficha, visita y renglón); Dary queda en P-434",
    [
      clash.loans.map((row) => row.ref).join(","),
      clash.assignments.map((row) => `${row.clientRef}:${row.loanRef}`).join(","),
      clash.drafts[0].expenses.map((row) => row.label).join(" | "),
      clash.drafts[0].expensesTotal,
    ].join(" / "),
    "P-442 / COD-62:P-434,COD-37:P-442 / Préstamo · P-434 · Dary Amor | Préstamo · P-442 · Bader / 1900000",
  );
  const celinaGas = {
    ...gasM,
    expenses: [gasLine("P-437", "Celina", 2_000_000), gasLine("P-439", "Celina", 2_000_000)],
    expensesTotal: 4_000_000,
  };
  const twin = renameLoanRefInState(
    {
      loans: [mLoan("P-437", "COD-65", "Celina", 2_000_000), mLoan("P-439", "COD-65", "Celina", 2_000_000)],
      loanQueue: [mLoan("P-439", "COD-65", "Celina", 2_000_000)],
      assignments: [visit("P-437", "COD-65"), visit("P-439", "COD-65")],
      drafts: [celinaGas],
    },
    { ref: "P-439", clientRef: "COD-65", client: "Celina" },
    "P-437",
    "2026-10-07",
  );
  expect(
    "Reintento Celina: P-439 se une a P-437 (una ficha, una visita, un renglón de 2.000.000)",
    [
      twin.twin,
      twin.loans.map((row) => row.ref).join(","),
      twin.loanQueue.length,
      twin.assignments.map((row) => row.loanRef).join(","),
      twin.drafts[0].expensesTotal,
    ].join(" / "),
    "true / P-437 / 0 / P-437 / 2000000",
  );
  const { readFileSync: readSrc } = await import("node:fs");
  const catalogSrc = readSrc(new URL("../lib/supabase/catalog-mirror.ts", import.meta.url), "utf8");
  const mobileSrc = readSrc(new URL("../components/CollectorMobileApp.tsx", import.meta.url), "utf8");
  expect(
    "Cerrar M no cierra T: el panel queda amarrado a su hoja, se cierra al cambiar y no acepta doble toque",
    mobileSrc.includes("setCloseTargetKey(activeCloseKey);") &&
      mobileSrc.includes("closeTargetKey !== activeCloseKey") &&
      mobileSrc.includes("closingDayRef.current = true;\n    setConfirmingClose(false);"),
    true,
  );
  const opsSrc = readSrc(new URL("../lib/supabase/ops-mirror.ts", import.meta.url), "utf8");
  const opsRouteSrc = readSrc(new URL("../app/api/ops/mirror/route.ts", import.meta.url), "utf8");
  expect(
    "Subida en paquetes: cola → /api/ops/mirror batch (≤20 filas), cada fila con su candado",
    opsSrc.includes("await postMirrorBatch(") &&
      opsSrc.includes("export const OPS_MIRROR_BATCH_MAX = 20;") &&
      opsRouteSrc.includes('body.kind === "batch"') &&
      opsRouteSrc.includes("await safeMirrorItem(item)"),
    true,
  );
  expect(
    "Nube: alta con insert (sin pisar otra ficha), une reintentos y la baja no toca a otro cliente",
    catalogSrc.includes('.from("loans").insert(row)') &&
      catalogSrc.includes("error.code !== UNIQUE_VIOLATION") &&
      catalogSrc.includes("findCloudLoanTwin(supabase, row)") &&
      catalogSrc.includes('reason: "loan_ref_other_client"'),
    true,
  );
  expect(
    "Renombre de ficha: el renglón del cobrador sigue al P- nuevo y sube a la nube",
    catalogSrc.includes("renameLoanRefInState(state, loan, to, businessTodayIso())") &&
      catalogSrc.includes("queueDayExpenseMirror(draft)"),
    true,
  );
}

// 29. Reabrir hoja de hoy (caso 07/10: T de Edgar se cerró con M, faltaban cobros).
// Supervisor/admin, solo hoy antes de 23:30, nunca M. La nube marca el CIE-; un cierre
// posterior manda; un aparato atrasado no la vuelve a cerrar.
{
  const {
    applySheetReopen,
    cieClosesRoute,
    dayCloseReopenFromRow,
    encodeSheetReopenRef,
    sheetReopenWindow,
  } = await import("@/lib/sheet-reopen");
  const { rowToDayClose } = await import("@/lib/supabase/ops-mirror");
  const closedAt = "2026-10-08T00:13:59.931Z";
  const reopenAt = "2026-10-08T00:40:00.000Z";
  const cieRow = (refs, closed = closedAt) => ({
    ref: "CIE-COB-0-2026-10-07",
    collector_ref: "COB-0",
    close_date: "2026-10-07",
    cash_float: 7_104_000,
    closed_at: closed,
    movement_refs: ["GASL-COB-0-2026-10-07-almuerzo", ...refs],
  });
  const marker = encodeSheetReopenRef({ route: "T", at: reopenAt, by: "Supervisor" });
  const reopened = cieRow([marker]);
  const reclosed = cieRow([marker], "2026-10-08T01:30:00.000Z");
  expect(
    "Reabierta: el CIE- deja de cerrar el día (rowToDayClose null) y solo para T",
    [
      rowToDayClose(reopened) === null,
      cieClosesRoute(reopened, "T"),
      cieClosesRoute(reopened, "M"),
      cieClosesRoute(reopened, "A"),
    ].join(","),
    "true,false,true,true",
  );
  expect(
    "Vuelve a cerrar después: el CIE- nuevo manda y la marca queda solo como historia",
    [
      rowToDayClose(reclosed)?.ref,
      rowToDayClose(reclosed)?.movementRefs.join(","),
      dayCloseReopenFromRow(reclosed) === null,
      cieClosesRoute(reclosed, "T"),
    ].join(" / "),
    "CIE-COB-0-2026-10-07 / GASL-COB-0-2026-10-07-almuerzo / true / true",
  );
  const bogota = (hhmm) => new Date(`2026-10-07T${hhmm}:00-05:00`);
  const cie = { ref: "CIE-COB-0-2026-10-07", collectorRef: "COB-0", date: "2026-10-07", closedAt, cashFloat: 7_104_000 };
  expect(
    "Ventana: T/A sí (hoy, antes de 23:30, con CIE-); M no; 23:30 no; sin CIE- no; con ajuste no",
    [
      sheetReopenWindow("COB-0", "T", [cie], bogota("19:45")).open,
      sheetReopenWindow("COB-0", "A", [cie], bogota("19:45")).open,
      sheetReopenWindow("COB-0", "M", [cie], bogota("19:45")).open,
      sheetReopenWindow("COB-0", "T", [cie], bogota("23:30")).open,
      sheetReopenWindow("COB-0", "T", [], bogota("19:45")).open,
      sheetReopenWindow(
        "COB-0",
        "T",
        [{ ...cie, cashAdjustment: { calculated: 1, real: 2, at: closedAt, by: "x", reason: "" } }],
        bogota("19:45"),
      ).open,
    ].join(","),
    "true,true,false,false,false,false",
  );
  const sealedVisit = (itemId, route, extra) => ({
    itemId,
    dispatchDate: "2026-10-07",
    collectorRef: "COB-0",
    clientRef: `C-${itemId}`,
    clientRoute: route,
    dispatched: true,
    dayClosedAt: "07:13 p. m.",
    amountDue: 0,
    ...extra,
  });
  const reopen = dayCloseReopenFromRow(reopened);
  const state = {
    dayCloses: [cie],
    planillaCashCloses: [{ ref: "PCE-COB-0-2026-10-07-T", collectorRef: "COB-0", collectorName: "Edgar", date: "2026-10-07", routeName: "T", openingCash: 0, closingCash: 7_104_000, closedAt }],
    assignments: [
      sealedVisit("t1", "T", { visitStatus: "omitido", skipReason: "Cierre de jornada" }),
      sealedVisit("t2", "T", { visitStatus: "cobrado", paymentRef: "PG-1" }),
      sealedVisit("t3", "T", { visitStatus: "omitido", skipReason: "No estaba" }),
      sealedVisit("m1", "M", { visitStatus: "omitido", skipReason: "Cierre de jornada" }),
    ],
  };
  const applied = applySheetReopen(state, reopen, []);
  expect(
    "Aparato: suelta CIE- y PCE-T; T vuelve a pendiente (cobro y N/P quedan); M sigue cerrada",
    [
      applied.dayCloses.length,
      applied.planillaCashCloses.length,
      applied.assignments
        .map((row) => `${row.itemId}:${row.visitStatus}:${row.dayClosedAt ? "S" : "A"}`)
        .join(","),
    ].join(" / "),
    "0 / 0 / t1:pendiente:A,t2:cobrado:A,t3:omitido:A,m1:omitido:S",
  );
  const relocal = applySheetReopen(
    { ...state, dayCloses: [{ ...cie, closedAt: "2026-10-08T01:30:00.000Z" }] },
    reopen,
    [],
  );
  expect("Aparato con cierre posterior: la reapertura vieja no lo toca", relocal.changed, false);
  const { readFileSync: readReopenSrc } = await import("node:fs");
  const opsReopenSrc = readReopenSrc(new URL("../lib/supabase/ops-mirror.ts", import.meta.url), "utf8");
  expect(
    "Nube: CIE- viejo no pisa la reapertura; visita sellada vieja no cierra T; el pull la aplica",
    opsReopenSrc.includes('reason: "cie_reopened"') &&
      opsReopenSrc.includes('reason: "hoja_reabierta"') &&
      opsReopenSrc.includes("applySheetReopensLocally(reopens, persist)"),
    true,
  );
}

if (failures) {
  console.error(`\n✖ Regla de inicio ROTA (${failures} falla${failures === 1 ? "" : "s"}). No se publica.`);
  process.exit(1);
}
console.log("\n✔ Regla de inicio intacta.");
