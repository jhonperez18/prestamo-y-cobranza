import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { compareRoutePosition, sameRoute } from "@/lib/client-route-order";
import { syncLoan, displayToIso } from "@/lib/loan-preview";
import { loanDisbursementSource } from "@/lib/nequi-pool";
import { isAssignmentAwaitingLoan, planillaLiveCuota } from "@/lib/planilla-display";
import { withPaymentEvidence } from "@/lib/payment-evidence-store";
import { paymentTimeLabel } from "@/lib/payment-detail";
import { normalizePaymentMethod } from "@/lib/payment-method";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

function isPrestamoRutaExpense(line: RouteExpenseLine) {
  return line.category === "prestamo_ruta" || line.id === "prestamo";
}

export type HistoryPayMethod =
  | "efectivo"
  | "nequi"
  | "banco"
  | "doble"
  | "np"
  | "vacio"
  | "prestamo";

export type CollectorHistoryPlanillaRow = {
  key: string;
  clientRef: string;
  route: string;
  order: number | null;
  name: string;
  amount: number | null;
  time: string;
  evidence: NonNullable<PaymentRow["evidence"]>;
  method: HistoryPayMethod;
  /** Cliente recibió desembolso hoy (gris en planilla). */
  lentToday: boolean;
};

function isHistoryFiller(row: DailyCollectionAssignment) {
  return isAssignmentAwaitingLoan(row);
}

function historyPayMethod(pays: PaymentRow[]): HistoryPayMethod {
  const methods = new Set(pays.map((row) => normalizePaymentMethod(row.method)));
  const combo = pays.some((row) => row.comboGroupId) && pays.length > 1;
  if (methods.size > 1 || combo) return "doble";
  return [...methods][0] ?? "efectivo";
}

function historyClock(pays: PaymentRow[]) {
  const label = pays
    .map((pay) => paymentTimeLabel(pay).trim())
    .find((value) => value && value !== "00:00" && value !== "0:00");
  return label ? formatHistoryMilitaryTime(label) : "—";
}

/**
 * Hora militar sin cero delante (planilla historial cobrador / supervisor).
 * Ej.: 8:25 · 15:38 (no 05:53 p. m.).
 */
export function formatHistoryMilitaryTime(raw: string): string {
  const text = String(raw || "").trim();
  if (!text || text === "—") return "—";

  const plain = text.match(/^(\d{1,2}):(\d{2})$/);
  if (plain) {
    const hour = Number(plain[1]);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      return `${hour}:${plain[2]}`;
    }
  }

  const ampm = text.match(
    /^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\.?$/i,
  );
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2];
    const meridiem = ampm[3].replace(/\s|\./g, "").toLowerCase();
    const isPm = meridiem.startsWith("p");
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return `${hour}:${minute}`;
  }

  return text;
}

function payerName(pay: PaymentRow, loans: LoanRow[], clients: ClientRow[]) {
  const loan = loans.find((row) => row.ref === pay.loanRef);
  const client = clients.find((row) => row.ref === (loan?.clientRef || ""));
  if (client) return `${client.name} ${client.lastName}`.trim();
  return (pay.client || "").trim() || "—";
}

function visitOrder(
  item: DailyCollectionAssignment,
  clients: ClientRow[],
): number | null {
  const client = clients.find((row) => row.ref === item.clientRef);
  if (client?.routeOrder && client.routeOrder > 0) return client.routeOrder;
  return null;
}

function visitFullName(
  item: DailyCollectionAssignment,
  clients: ClientRow[],
): string {
  const client = clients.find((row) => row.ref === item.clientRef);
  if (client) return `${client.name} ${client.lastName}`.trim();
  return (item.clientName || "").trim() || "—";
}

/** Gastos del día: préstamos (caja) vs el resto. Coincide con el cuadre. */
export function splitDayExpenses(expenses: RouteExpenseLine[]) {
  const prestamos = expenses.filter((row) => isPrestamoRutaExpense(row));
  const otros = expenses.filter((row) => !isPrestamoRutaExpense(row));
  const prestamosTotal = prestamos.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const otrosTotal = otros.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    prestamos,
    otros,
    prestamosTotal,
    otrosTotal,
    total: prestamosTotal + otrosTotal,
  };
}

/** Filas de desembolso del día: a quién, capital y cuota pactada. */
export type DayLoanDisbursementRow = {
  loanRef: string;
  clientRef: string;
  clientName: string;
  capital: number;
  installment: number;
};

export type DayLoanDisbursementScope = {
  collectorRef?: string;
  /** Visitas del día: limita créditos al cobrador de esa hoja. */
  assignments?: DailyCollectionAssignment[];
};

/**
 * Desembolsos que salen de caja de UN cobrador ese día.
 * Regla de oro: nunca mezclar cobradores. Solo:
 * 1) líneas de gasto ya guardadas en SU día (GAS-/CIE ya filtrados por cobrador), y
 * 2) créditos en efectivo de clientes de SU hoja ese día.
 *
 * Crédito prestado hoy sale de la planilla de cobro (cuota = mañana). No filtrar
 * la línea GAS-/CIE por dayClientRefs: si no, el botón Préstamos queda en 0
 * aunque el desembolso ya está en caja del cobrador.
 */
export function dayLoanDisbursementRows(
  dateIso: string,
  expenses: RouteExpenseLine[],
  loans: LoanRow[],
  clients: ClientRow[],
  scope: DayLoanDisbursementScope = {},
): DayLoanDisbursementRow[] {
  const byLoan = new Map<string, DayLoanDisbursementRow>();
  const collectorRef = String(scope.collectorRef || "").trim();
  const dayClientRefs = new Set<string>();
  for (const row of scope.assignments ?? []) {
    if (collectorRef && row.collectorRef !== collectorRef) continue;
    if ((normalizeHistoryDateSafe(row.dispatchDate) || row.dispatchDate) !== dateIso) continue;
    if (row.clientRef) dayClientRefs.add(row.clientRef);
  }

  // 1) Gastos del cobrador (ya vienen de su CIE / borrador) — fuente primaria.
  for (const line of expenses) {
    if (!isPrestamoRutaExpense(line)) continue;
    const loanRef = String(line.loanRef || "").trim();
    if (!loanRef || byLoan.has(loanRef)) continue;
    const loan = loans.find((row) => row.ref === loanRef);
    const clientRef = loan?.clientRef || "";
    const client = clients.find((row) => row.ref === clientRef);
    const clientName = client
      ? `${client.name} ${client.lastName}`.trim()
      : (loan?.client || "").trim() || line.label.replace(/^Préstamo\s*·\s*/i, "");
    byLoan.set(loanRef, {
      loanRef,
      clientRef,
      clientName,
      capital: Number(line.amount) || Math.trunc(Number(loan?.capital) || 0),
      installment: Math.trunc(Number(loan?.installment) || 0),
    });
    if (clientRef) dayClientRefs.add(clientRef);
  }

  // Rutas que este cobrador tocó hoy (planilla) — por si faltó GAS- en el pull.
  const collectorRoutes = new Set<string>();
  for (const row of scope.assignments ?? []) {
    if (collectorRef && row.collectorRef !== collectorRef) continue;
    if ((normalizeHistoryDateSafe(row.dispatchDate) || row.dispatchDate) !== dateIso) continue;
    const route = assignmentRouteName(row, clients).trim();
    if (route) collectorRoutes.add(route);
  }

  // 2) Reconstrucción: créditos en efectivo de hoy de clientes de SU hoja o SU ruta.
  if (!collectorRef) {
    return [...byLoan.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
  }

  for (const loan of loans) {
    const started = displayToIso(String(loan.date || "").trim());
    if (started !== dateIso || byLoan.has(loan.ref)) continue;
    const source = loanDisbursementSource(loan);
    // Nequi/banco del sistema ≠ caja del cobrador.
    if (source === "nequi" || source === "banco") continue;
    const client = clients.find((row) => row.ref === loan.clientRef);
    const onSheet = dayClientRefs.has(loan.clientRef);
    const onRoute =
      Boolean(client?.route) &&
      [...collectorRoutes].some((route) => sameRoute(route, client?.route));
    if (!onSheet && !onRoute) continue;
    byLoan.set(loan.ref, {
      loanRef: loan.ref,
      clientRef: loan.clientRef,
      clientName: client
        ? `${client.name} ${client.lastName}`.trim()
        : (loan.client || "").trim() || loan.ref,
      capital: Math.trunc(Number(loan.capital) || 0),
      installment: Math.trunc(Number(loan.installment) || 0),
    });
  }

  return [...byLoan.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}

export function dayLoanDisbursementTotal(rows: DayLoanDisbursementRow[]) {
  return rows.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
}

/** Líneas de gasto lista para UI/cierre: operativos + desembolsos reconstruidos. */
export function expensesWithDayLoans(
  dateIso: string,
  expenses: RouteExpenseLine[],
  loans: LoanRow[],
  clients: ClientRow[],
  scope: DayLoanDisbursementScope = {},
): RouteExpenseLine[] {
  const otros = expenses.filter((row) => !isPrestamoRutaExpense(row));
  const prestamos = dayLoanDisbursementRows(dateIso, expenses, loans, clients, scope).map(
    (row) =>
      ({
        id: "prestamo",
        label: `Préstamo · ${row.loanRef} · ${row.clientName}`,
        amount: row.capital,
        category: "prestamo_ruta",
        loanRef: row.loanRef,
      }) as RouteExpenseLine,
  );
  return [...otros, ...prestamos];
}

function normalizeHistoryDateSafe(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return displayToIso(text);
}

/** ClientRefs con desembolso de ESE cobrador ese día (nunca catálogo global). */
export function clientRefsLentOnDate(
  dateIso: string,
  expenses: RouteExpenseLine[],
  loans: LoanRow[],
  clients: ClientRow[] = [],
  scope: DayLoanDisbursementScope = {},
): Set<string> {
  const refs = new Set<string>();
  for (const row of dayLoanDisbursementRows(dateIso, expenses, loans, clients, scope)) {
    if (row.clientRef) refs.add(row.clientRef);
  }
  return refs;
}

/** Créditos dados de alta ese día (la cuota entra a ruta al día siguiente). */
function loanRefsStartedOnDate(dateIso: string, loans: LoanRow[]): Set<string> {
  const refs = new Set<string>();
  for (const loan of loans) {
    const started = displayToIso(String(loan.date || "").trim());
    if (started === dateIso && loan.ref) refs.add(loan.ref);
  }
  return refs;
}

export function historyMethodLabel(method: HistoryPayMethod) {
  if (method === "nequi") return "Nequi";
  if (method === "banco") return "Banco";
  if (method === "doble") return "Doble";
  if (method === "np") return "N/P";
  if (method === "prestamo") return "Prestado";
  if (method === "vacio") return "—";
  return "Efectivo";
}

/**
 * Planilla del día tal como la registró el cobrador (mismo orden ruta → #).
 * Cobros normales (sin gris). Solo la fila «Prestado» va gris, con el capital desembolsado.
 * La cuota del crédito nuevo no aparece el mismo día: entra a ruta al siguiente.
 */
export function buildCollectorHistoryPlanillaRows(input: {
  dateIso: string;
  dispatched: DailyCollectionAssignment[];
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  expenses?: RouteExpenseLine[];
}): CollectorHistoryPlanillaRow[] {
  const { dateIso, dispatched, payments, loans, clients, expenses = [] } = input;
  const loansStartedToday = loanRefsStartedOnDate(dateIso, loans);
  const pays = payments
    .filter((row) => !row.voidedAt?.trim())
    .map((row) => withPaymentEvidence(row));
  const used = new Set<string>();
  const rows: CollectorHistoryPlanillaRow[] = [];

  const visitClientRefs = new Set(
    dispatched.filter((item) => !isHistoryFiller(item)).map((item) => item.clientRef),
  );
  const paidClientRefs = new Set(
    pays.map((pay) => loans.find((row) => row.ref === pay.loanRef)?.clientRef || ""),
  );

  for (const item of dispatched) {
    if (
      isHistoryFiller(item) &&
      (visitClientRefs.has(item.clientRef) || paidClientRefs.has(item.clientRef))
    ) {
      continue;
    }
    // Crédito nuevo del día → no es cobro; se marca aparte como «Prestado».
    if (item.loanRef && loansStartedToday.has(item.loanRef)) continue;

    const rawLoan = item.loanRef
      ? loans.find((row) => row.ref === item.loanRef)
      : undefined;
    const loan = rawLoan ? (syncLoan(rawLoan, payments) as LoanRow) : null;
    const cuota = isHistoryFiller(item)
      ? 0
      : planillaLiveCuota(item, loan, payments, dateIso);
    const sinCuota = isHistoryFiller(item) || !(cuota > 0);
    const matched = pays.filter((pay) => {
      if (used.has(pay.ref)) return false;
      if (item.paymentRef && pay.ref === item.paymentRef) return true;
      return Boolean(item.loanRef && pay.loanRef && pay.loanRef === item.loanRef);
    });
    if (matched.length === 0 && item.paymentRef && used.has(item.paymentRef)) continue;
    const comboIds = new Set(
      matched.map((pay) => pay.comboGroupId).filter((id): id is string => Boolean(id)),
    );
    const grouped = pays.filter((pay) => {
      if (matched.some((row) => row.ref === pay.ref)) return true;
      return Boolean(pay.comboGroupId && comboIds.has(pay.comboGroupId));
    });
    for (const pay of grouped) used.add(pay.ref);
    rows.push({
      key: `${item.itemId}-${item.dispatchDate}`,
      clientRef: item.clientRef,
      route: assignmentRouteName(item, clients),
      order: visitOrder(item, clients),
      name: visitFullName(item, clients),
      amount: grouped.length
        ? grouped.reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0)
        : sinCuota
          ? null
          : cuota,
      time: grouped.length ? historyClock(grouped) : "—",
      evidence: grouped.length ? grouped.flatMap((pay) => pay.evidence ?? []) : [],
      method: grouped.length
        ? historyPayMethod(grouped)
        : sinCuota
          ? "vacio"
          : "np",
      // Cobro / N/P / vacío: nunca gris. El gris es solo «Prestado».
      lentToday: false,
    });
  }

  for (const pay of pays) {
    if (used.has(pay.ref)) continue;
    // Pago del crédito recién prestado el mismo día no aplica; el desembolso va aparte.
    if (pay.loanRef && loansStartedToday.has(pay.loanRef)) {
      used.add(pay.ref);
      continue;
    }
    const siblings = pay.comboGroupId
      ? pays.filter((row) => row.comboGroupId === pay.comboGroupId)
      : [pay];
    if (siblings.some((row) => row.ref !== pay.ref && used.has(row.ref))) {
      used.add(pay.ref);
      continue;
    }
    for (const row of siblings) used.add(row.ref);
    const loan = loans.find((row) => row.ref === pay.loanRef);
    const client = clients.find((row) => row.ref === loan?.clientRef);
    const clientRef = client?.ref || loan?.clientRef || "";
    rows.push({
      key: siblings.map((row) => row.ref).join("|"),
      clientRef,
      route: String(client?.route || "").trim(),
      order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
      name: payerName(pay, loans, clients),
      amount: siblings.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
      time: historyClock(siblings),
      evidence: siblings.flatMap((row) => row.evidence ?? []),
      method: historyPayMethod(siblings),
      lentToday: false,
    });
  }

  // Una sola fila gris por desembolso: capital (solo de la hoja de ESTE cobrador).
  const sheetClientRefs = new Set(
    dispatched.map((item) => item.clientRef).filter(Boolean),
  );
  const prestamoKeys = new Set<string>();
  for (const line of expenses) {
    if (!isPrestamoRutaExpense(line)) continue;
    const loanRef = String(line.loanRef || "").trim();
    const loan = loanRef ? loans.find((row) => row.ref === loanRef) : undefined;
    const clientRef = loan?.clientRef || "";
    if (!clientRef) continue;
    // Regla de oro: no pintar prestamos ajenos aunque el gasto se filtró mal.
    if (sheetClientRefs.size > 0 && !sheetClientRefs.has(clientRef)) continue;
    const key = `prestamo:${loanRef || line.id}`;
    if (prestamoKeys.has(key)) continue;
    prestamoKeys.add(key);
    const client = clients.find((row) => row.ref === clientRef);
    const capital =
      Number(line.amount) ||
      Math.trunc(Number(loan?.capital) || 0) ||
      0;
    rows.push({
      key,
      clientRef,
      route: String(client?.route || "").trim(),
      order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
      name: client
        ? `${client.name} ${client.lastName}`.trim()
        : line.label.replace(/^Préstamo\s*·\s*/i, ""),
      amount: capital,
      time: "—",
      evidence: [],
      method: "prestamo",
      lentToday: true,
    });
  }

  // Alta del día sin gasto en cola: solo si el cliente está en ESTA planilla.
  for (const loan of loans) {
    if (!loansStartedToday.has(loan.ref)) continue;
    if (!sheetClientRefs.has(loan.clientRef)) continue;
    const key = `prestamo:${loan.ref}`;
    if (prestamoKeys.has(key)) continue;
    prestamoKeys.add(key);
    const client = clients.find((row) => row.ref === loan.clientRef);
    if (!client && !loan.clientRef) continue;
    rows.push({
      key,
      clientRef: loan.clientRef,
      route: String(client?.route || "").trim(),
      order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
      name: client
        ? `${client.name} ${client.lastName}`.trim()
        : (loan.client || "").trim() || loan.ref,
      amount: Math.trunc(Number(loan.capital) || 0),
      time: "—",
      evidence: [],
      method: "prestamo",
      lentToday: true,
    });
  }

  return rows.sort(
    (a, b) =>
      compareRoutePosition(a.route, a.order, b.route, b.order) ||
      a.name.localeCompare(b.name, "es"),
  );
}
