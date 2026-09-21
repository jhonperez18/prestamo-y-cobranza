import { computeLoanFinancials } from "@/lib/loan-balance";
import { loanStatusPill } from "@/lib/loan-status";
import { syncLoan } from "@/lib/loan-preview";
import { livePayments } from "@/lib/live-payments";
import {
  activeLoans,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";

export type CarteraGroupRow = {
  key: string;
  label: string;
  clients: number;
  loans: number;
  balance: number;
  moraLoans: number;
  moraBalance: number;
  collectedMonth: number;
};

function monthKey(payment: PaymentRow, year: number) {
  const paidDate = payment.paidDate?.trim() || "";
  if (paidDate.length >= 7) return paidDate.slice(0, 7);
  const match = payment.when.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!match) return null;
  const month = match[2]!.padStart(2, "0");
  const y = match[3] ?? String(year);
  return `${y}-${month}`;
}

function syncedActive(loans: LoanRow[], payments: PaymentRow[]) {
  const live = livePayments(payments);
  return activeLoans(loans.map((loan) => syncLoan(loan, live) as LoanRow));
}

function collectorForClientRoute(
  routeName: string,
  routes: RouteRow[],
  collectors: CollectorRow[],
) {
  const route = routes.find(
    (row) => row.name.trim().toLowerCase() === routeName.trim().toLowerCase(),
  );
  if (!route?.collectorRef) return null;
  return collectors.find((c) => c.ref === route.collectorRef) ?? null;
}

/** Cartera operativa agrupada por cobrador (PG- vivos + préstamos + rutas). */
export function buildCarteraByCollector(
  loans: LoanRow[],
  payments: PaymentRow[],
  clients: ClientRow[],
  collectors: CollectorRow[],
  routes: RouteRow[],
  now = new Date(),
): CarteraGroupRow[] {
  const live = livePayments(payments);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const active = syncedActive(loans, live);
  const clientByRef = new Map(clients.map((c) => [c.ref, c]));
  const collectorByRef = new Map(collectors.map((c) => [c.ref, c]));

  type Acc = {
    label: string;
    clientRefs: Set<string>;
    loans: number;
    balance: number;
    moraLoans: number;
    moraBalance: number;
    collectedMonth: number;
  };
  const map = new Map<string, Acc>();

  function bucket(key: string, label: string): Acc {
    let row = map.get(key);
    if (!row) {
      row = {
        label,
        clientRefs: new Set(),
        loans: 0,
        balance: 0,
        moraLoans: 0,
        moraBalance: 0,
        collectedMonth: 0,
      };
      map.set(key, row);
    }
    return row;
  }

  for (const loan of active) {
    const client = clientByRef.get(loan.clientRef);
    const routeName = client?.route?.trim() || "";
    const collector = collectorForClientRoute(routeName, routes, collectors);
    const key = collector?.ref || "none";
    const label = collector?.name?.trim() || "Sin asignar";
    const acc = bucket(key, label);
    const balance = computeLoanFinancials(loan, live).balancePending;
    if (balance <= 0) continue;
    acc.loans += 1;
    acc.balance += balance;
    if (loan.clientRef) acc.clientRefs.add(loan.clientRef);
    if (loanStatusPill(loan).kind === "overdue") {
      acc.moraLoans += 1;
      acc.moraBalance += balance;
    }
  }

  for (const pay of live) {
    if (monthKey(pay, now.getFullYear()) !== currentMonth) continue;
    const key = pay.collectorRef?.trim() || "none";
    const label =
      collectorByRef.get(key)?.name?.trim() || pay.collector?.trim() || "Sin asignar";
    bucket(key, label).collectedMonth += pay.amount;
  }

  return [...map.entries()]
    .map(([key, acc]) => ({
      key,
      label: acc.label,
      clients: acc.clientRefs.size,
      loans: acc.loans,
      balance: acc.balance,
      moraLoans: acc.moraLoans,
      moraBalance: acc.moraBalance,
      collectedMonth: acc.collectedMonth,
    }))
    .filter((row) => row.loans > 0 || row.collectedMonth > 0)
    .sort((a, b) => b.balance - a.balance || a.label.localeCompare(b.label, "es"));
}

/** Cartera operativa agrupada por ruta. */
export function buildCarteraByRoute(
  loans: LoanRow[],
  payments: PaymentRow[],
  clients: ClientRow[],
  now = new Date(),
): CarteraGroupRow[] {
  const live = livePayments(payments);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const active = syncedActive(loans, live);
  const clientByRef = new Map(clients.map((c) => [c.ref, c]));

  type Acc = {
    label: string;
    clientRefs: Set<string>;
    loans: number;
    balance: number;
    moraLoans: number;
    moraBalance: number;
    collectedMonth: number;
  };
  const map = new Map<string, Acc>();

  function bucket(label: string): Acc {
    const key = label || "Sin ruta";
    let row = map.get(key);
    if (!row) {
      row = {
        label: key,
        clientRefs: new Set(),
        loans: 0,
        balance: 0,
        moraLoans: 0,
        moraBalance: 0,
        collectedMonth: 0,
      };
      map.set(key, row);
    }
    return row;
  }

  for (const loan of active) {
    const client = clientByRef.get(loan.clientRef);
    const route = client?.route?.trim() || "Sin ruta";
    const acc = bucket(route);
    const balance = computeLoanFinancials(loan, live).balancePending;
    if (balance <= 0) continue;
    acc.loans += 1;
    acc.balance += balance;
    if (loan.clientRef) acc.clientRefs.add(loan.clientRef);
    if (loanStatusPill(loan).kind === "overdue") {
      acc.moraLoans += 1;
      acc.moraBalance += balance;
    }
  }

  for (const pay of live) {
    if (monthKey(pay, now.getFullYear()) !== currentMonth) continue;
    const loan = loans.find((l) => l.ref === pay.loanRef);
    const client = loan ? clientByRef.get(loan.clientRef) : undefined;
    const route = client?.route?.trim() || "Sin ruta";
    bucket(route).collectedMonth += pay.amount;
  }

  return [...map.values()]
    .map((acc) => ({
      key: acc.label,
      label: acc.label,
      clients: acc.clientRefs.size,
      loans: acc.loans,
      balance: acc.balance,
      moraLoans: acc.moraLoans,
      moraBalance: acc.moraBalance,
      collectedMonth: acc.collectedMonth,
    }))
    .filter((row) => row.loans > 0 || row.collectedMonth > 0)
    .sort((a, b) => b.balance - a.balance || a.label.localeCompare(b.label, "es"));
}
