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
 */
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const { buildDayCashLedger, chainDayCuadre, chainHistorySplit, withLedgerTodaySaldo } = await import(
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

// Cierre del día (supervisor): M = la mañana; T = día entero M+T, misma Caja que el libro.
const sumLines = (lines, loan) =>
  lines.filter((l) => (l.category === "prestamo_ruta") === loan).reduce((s, l) => s + l.amount, 0);
const cuadreM = chainDayCuadre(baseT, "primary");
const cuadreT = chainDayCuadre(baseT, "secondary");
expect("Cierre M · Inicial = CIE de ayer", cuadreM.opening, 2_704_000);
expect("Cierre M · efectivo solo M", cuadreM.efectivo, ledgerT.m.efectivo);
expect("Cierre M · préstamos solo M", sumLines(cuadreM.lines, true), 300_000);
expect("Cierre M · Caja = Inicial de T", cuadreM.closing, ledgerT.mClosing);
expect("Cierre T · Inicial = Inicial de M", cuadreT.opening, 2_704_000);
expect("Cierre T · efectivo M+T", cuadreT.efectivo, ledgerT.m.efectivo + ledgerT.t.efectivo);
expect("Cierre T · efectivo solo T", cuadreT.ownEfectivo, ledgerT.t.efectivo);
expect("Cierre T · solo T + M = total", cuadreT.ownEfectivo + cuadreM.ownEfectivo, cuadreT.efectivo);
expect("Cierre T · préstamos M+T", sumLines(cuadreT.lines, true), 400_000);
expect("Cierre T · gastos M+T", sumLines(cuadreT.lines, false), 30_000);
expect("Cierre T · Caja = saldo final del día", cuadreT.closing, ledgerT.dayFinal);
expect(
  "Cierre T · Inicial + efectivo − préstamos − gastos = Caja",
  cuadreT.opening + cuadreT.efectivo - sumLines(cuadreT.lines, true) - sumLines(cuadreT.lines, false),
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

if (failures) {
  console.error(`\n✖ Regla de inicio ROTA (${failures} falla${failures === 1 ? "" : "s"}). No se publica.`);
  process.exit(1);
}
console.log("\n✔ Regla de inicio intacta.");
