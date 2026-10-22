/**
 * Hoja mensual de una ruta. Solo lectura: no escribe pagos, fichas ni caja.
 * Inicial = lo que debía al empezar el mes. Cada día de cobro resta el pago.
 * Una renovación pone el total nuevo en esa celda y de ahí sigue la resta.
 * El saldo del corte es el inicial del mes siguiente.
 */
import { clientsOnRouteSorted } from "@/lib/client-route-order";
import { isDailyCollectionDay } from "@/lib/colombia-holidays";
import { pesos } from "@/lib/finance";
import { isPaymentLive } from "@/lib/live-payments";
import { loanDisbursementIsoDate } from "@/lib/nequi-pool";
import { loanRenewalOf, loanRenewedInto } from "@/lib/loan-renewal-marks";
import { isLoanDeletedStatus } from "@/lib/supabase/catalog-mirror";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

export const MONTHLY_SHEET_FROM = "2026-10";

const ROUTES = ["M", "T", "N", "A"] as const;
export type MonthlyRouteName = (typeof ROUTES)[number];

export function isMonthlyRouteName(value: string): value is MonthlyRouteName {
  return (ROUTES as readonly string[]).includes(value);
}

export type MonthSheetCell =
  | { kind: "pay"; amount: number }
  | { kind: "renewal"; amount: number }
  | { kind: "loan"; amount: number };

export type MonthSheetRow = {
  clientRef: string;
  order: number;
  name: string;
  inicial: number;
  cells: Array<MonthSheetCell | null>;
  saldo: number;
};

export type MonthSheet = {
  route: MonthlyRouteName;
  month: string;
  days: string[];
  rows: MonthSheetRow[];
  /** El mes todavía no cierra: el saldo es el de hoy. */
  open: boolean;
};

/** Miles sin punto: 70.000 → «70», 1.500.000 → «1500». */
export function sheetMiles(value: number) {
  if (!value) return "";
  return String(Math.round(pesos(value) / 1000));
}

export function monthStartIso(month: string) {
  return `${month}-01`;
}

export function monthEndIso(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export function collectionDaysOfMonth(month: string) {
  const end = monthEndIso(month);
  const days: string[] = [];
  for (let iso = monthStartIso(month); iso <= end; iso = nextIso(iso)) {
    if (isDailyCollectionDay(iso)) days.push(iso);
  }
  return days;
}

/** Meses ya vencidos, del más reciente al primero. El mes en curso no entra. */
export function closedMonths(today: string) {
  const current = today.slice(0, 7);
  const months: string[] = [];
  for (let month = previousMonth(current); month >= MONTHLY_SHEET_FROM; month = previousMonth(month)) {
    months.push(month);
  }
  return months;
}

export function monthLabel(month: string) {
  const names = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const [year, mon] = month.split("-");
  return `${names[Number(mon) - 1] ?? month} ${year}`;
}

export function buildMonthlyRouteSheet(input: {
  route: MonthlyRouteName;
  month: string;
  today: string;
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
}): MonthSheet {
  const monthStart = monthStartIso(input.month);
  const monthEnd = monthEndIso(input.month);
  const realToday = input.today;
  const closed = input.month < realToday.slice(0, 7);
  const cut = closed ? monthEnd : realToday < monthStart ? monthStart : realToday;
  const days = collectionDaysOfMonth(input.month);
  const loansByClient = new Map<string, LoanRow[]>();
  for (const loan of input.loans) {
    if (!loan.clientRef || isLoanDeletedStatus(loan)) continue;
    const list = loansByClient.get(loan.clientRef) ?? [];
    list.push(loan);
    loansByClient.set(loan.clientRef, list);
  }
  const paysByLoan = new Map<string, PaymentRow[]>();
  for (const pay of input.payments) {
    if (!pay.loanRef || !isPaymentLive(pay)) continue;
    const day = (pay.paidDate || "").slice(0, 10);
    if (!day || day < monthStart || day > realToday) continue;
    const list = paysByLoan.get(pay.loanRef) ?? [];
    list.push(pay);
    paysByLoan.set(pay.loanRef, list);
  }

  const rows: MonthSheetRow[] = [];
  for (const client of clientsOnRouteSorted(input.clients, input.route)) {
    const loans = loansByClient.get(client.ref) ?? [];
    if (!loans.length) continue;
    const row = sheetRow(client, loans, paysByLoan, days, monthStart, monthEnd, cut, realToday);
    if (!row.inicial && !row.saldo && row.cells.every((cell) => !cell)) continue;
    rows.push(row);
  }

  return {
    route: input.route,
    month: input.month,
    days,
    rows,
    open: !closed,
  };
}

function sheetRow(
  client: ClientRow,
  loans: LoanRow[],
  paysByLoan: Map<string, PaymentRow[]>,
  days: string[],
  monthStart: string,
  monthEnd: string,
  cut: string,
  realToday: string,
): MonthSheetRow {
  const cells: Array<MonthSheetCell | null> = days.map(() => null);
  const active = loanActiveAtStart(loans, monthStart);
  const inicial = active ? openingBalance(active, paysByLoan, monthStart, realToday) : 0;
  let running = inicial;
  let current = active;

  const bornInMonth = loans
    .filter((loan) => {
      const start = loanDisbursementIsoDate(loan);
      return Boolean(start) && start >= monthStart && start <= monthEnd;
    })
    .sort((a, b) => loanDisbursementIsoDate(a).localeCompare(loanDisbursementIsoDate(b)));

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index] ?? "";
    if (!day || day > cut) break;
    const bornToday = bornInMonth.filter(
      (loan) => placeOnSheet(loanDisbursementIsoDate(loan), days) === day,
    );
    const born = bornToday.find((loan) => loanRenewalOf(loan)) ?? bornToday[0];
    if (born && loanDisbursementIsoDate(born) > (current ? loanDisbursementIsoDate(current) : "")) {
      const total = loanTotal(born);
      const sameDay = paySum(paysByLoan.get(born.ref), day, days, cut);
      cells[index] = loanRenewalOf(born)
        ? { kind: "renewal", amount: total }
        : { kind: "loan", amount: total };
      running = Math.max(0, total - sameDay);
      current = born;
      continue;
    }
    if (!current) continue;
    const paid = paySum(paysByLoan.get(current.ref), day, days, cut);
    if (paid > 0) {
      cells[index] = { kind: "pay", amount: paid };
      running = Math.max(0, running - paid);
    }
  }

  const name = [client.name, client.lastName].filter(Boolean).join(" ").trim() || client.ref;
  return {
    clientRef: client.ref,
    order: client.routeOrder || 0,
    name,
    inicial,
    cells,
    saldo: running,
  };
}

function loanActiveAtStart(loans: LoanRow[], monthStart: string) {
  const prior = loans.filter((loan) => {
    const start = loanDisbursementIsoDate(loan);
    if (!start || start >= monthStart) return false;
    const into = loanRenewedInto(loan);
    if (!into) return true;
    const next = loans.find((row) => row.ref === into);
    const nextStart = next ? loanDisbursementIsoDate(next) : "";
    return !nextStart || nextStart >= monthStart;
  });
  prior.sort((a, b) => loanDisbursementIsoDate(b).localeCompare(loanDisbursementIsoDate(a)));
  return prior[0] ?? null;
}

/** Saldo al empezar el mes: total − lo pagado antes del mes. */
function openingBalance(
  loan: LoanRow,
  paysByLoan: Map<string, PaymentRow[]>,
  monthStart: string,
  today: string,
) {
  const total = loanTotal(loan);
  const paid = pesos(loan.paid);
  const seen = (paysByLoan.get(loan.ref) ?? [])
    .filter((pay) => {
      const day = (pay.paidDate || "").slice(0, 10);
      return day >= monthStart && day <= today;
    })
    .reduce((sum, pay) => sum + pesos(pay.amount), 0);
  const settledSeen = Math.min(seen, paid);
  return Math.max(0, total - (paid - settledSeen));
}

function paySum(pays: PaymentRow[] | undefined, day: string, days: string[], cut: string) {
  let sum = 0;
  for (const pay of pays ?? []) {
    const paid = (pay.paidDate || "").slice(0, 10);
    if (!paid || paid > cut) continue;
    if (placeOnSheet(paid, days) === day) sum += pesos(pay.amount);
  }
  return sum;
}

function loanTotal(loan: LoanRow) {
  const total = pesos(loan.total ?? 0);
  if (total > 0) return total;
  return pesos(loan.capital) + pesos(loan.interest ?? 0);
}

function placeOnSheet(iso: string, days: string[]) {
  if (!iso || !days.length) return "";
  if (days.includes(iso)) return iso;
  const next = days.find((day) => day > iso);
  if (next) return next;
  const prev = [...days].reverse().find((day) => day < iso);
  return prev ?? "";
}

function nextIso(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function previousMonth(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return date.toISOString().slice(0, 7);
}
