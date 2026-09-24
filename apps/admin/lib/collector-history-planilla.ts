import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { compareRoutePosition } from "@/lib/client-route-order";
import { syncLoan, displayToIso } from "@/lib/loan-preview";
import { isAssignmentAwaitingLoan, planillaLiveCuota } from "@/lib/planilla-display";
import { withPaymentEvidence } from "@/lib/payment-evidence-store";
import { paymentTimeLabel } from "@/lib/payment-detail";
import { normalizePaymentMethod } from "@/lib/payment-method";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

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
  return label || "—";
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
  const prestamos = expenses.filter((row) => row.category === "prestamo_ruta");
  const otros = expenses.filter((row) => row.category !== "prestamo_ruta");
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

/** ClientRefs que recibieron préstamo de ruta ese día (gasto prestamo_ruta o alta del crédito). */
export function clientRefsLentOnDate(
  dateIso: string,
  expenses: RouteExpenseLine[],
  loans: LoanRow[],
): Set<string> {
  const refs = new Set<string>();
  for (const line of expenses) {
    if (line.category !== "prestamo_ruta") continue;
    const loanRef = String(line.loanRef || "").trim();
    if (!loanRef) continue;
    const loan = loans.find((row) => row.ref === loanRef);
    if (loan?.clientRef) refs.add(loan.clientRef);
  }
  for (const loan of loans) {
    if (!loan.clientRef) continue;
    const started = displayToIso(String(loan.date || "").trim());
    if (started === dateIso) refs.add(loan.clientRef);
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
 * Incluye cobros / N/P y marca en gris a quien se le prestó.
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
  const lentRefs = clientRefsLentOnDate(dateIso, expenses, loans);
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
    const clientRef = item.clientRef;
    const lentToday = lentRefs.has(clientRef);
    rows.push({
      key: `${item.itemId}-${item.dispatchDate}`,
      clientRef,
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
      method: lentToday && !grouped.length
        ? "prestamo"
        : grouped.length
          ? historyPayMethod(grouped)
          : sinCuota
            ? "vacio"
            : "np",
      lentToday,
    });
  }

  for (const pay of pays) {
    if (used.has(pay.ref)) continue;
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
      lentToday: lentRefs.has(clientRef),
    });
  }

  // Prestados del día que no aparecieron en visitas (desembolso sin fila de cobro).
  for (const line of expenses) {
    if (line.category !== "prestamo_ruta") continue;
    const loanRef = String(line.loanRef || "").trim();
    const loan = loanRef ? loans.find((row) => row.ref === loanRef) : undefined;
    const clientRef = loan?.clientRef || "";
    if (!clientRef) continue;
    if (rows.some((row) => row.clientRef === clientRef && row.lentToday)) continue;
    const client = clients.find((row) => row.ref === clientRef);
    rows.push({
      key: `prestamo:${loanRef || line.id}`,
      clientRef,
      route: String(client?.route || "").trim(),
      order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
      name: client
        ? `${client.name} ${client.lastName}`.trim()
        : line.label.replace(/^Préstamo\s*·\s*/i, ""),
      amount: Number(line.amount) || 0,
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
