import { CLIENT_STATUS_ACTIVE, clientStatusKind } from "@/lib/client-review";
import { placeClientOnRoute, nextRouteOrder } from "@/lib/client-route-order";
import { toClientNameTitleCase } from "@/lib/client-name-case";
import { todayIso } from "@/lib/daily-dispatch";
import {
  LOAN_TERM_OPTIONS,
  PAY_FREQUENCIES,
  isoToDisplay,
  previewLoanFlat,
  syncLoan,
  type LoanTermMonths,
  type PayFrequency,
} from "@/lib/loan-preview";
import {
  clientCreationDate,
  nextClientCode,
  nextLoanCode,
  type ClientRow,
  type LoanRow,
} from "@/lib/mock-data";
import { markLoanFundedByBanco, markLoanFundedByEfectivo, markLoanFundedByNequi } from "@/lib/nequi-pool";

/**
 * Alta de cliente (calle / supervisor).
 * Solo entra al catálogo sagrado. Ruta y posición se asignan al crear el préstamo.
 */
export type StreetClientDraft = {
  name: string;
  lastName?: string;
  phone?: string;
  createdBy?: string;
};

export type QuickLoanDraft = {
  clientRef: string;
  capital: number;
  /** Interés total en pesos (p.ej. capital × %). */
  interest: number;
  /** Tasa % usada para mostrar/guardar (opcional). */
  rate?: number;
  frequency: PayFrequency;
  termMonths: LoanTermMonths;
  /** Cuota pactada a mano; si falta, se calcula sola. */
  installmentAmount?: number;
  /** Al prestar: el cliente queda en esta ruta (planilla). */
  routeName?: string;
  /** Origen del desembolso. Por defecto Nequi (supervisor/admin). */
  fundedBy?: "nequi" | "efectivo" | "banco";
};

export const QUICK_INTEREST_PCT = [5, 10, 15, 20] as const;

/** Cliente nuevo → catálogo, sin ruta. */
export function buildStreetClient(
  draft: StreetClientDraft,
  clients: ClientRow[],
): ClientRow {
  const name = toClientNameTitleCase(draft.name.trim());
  const lastName = toClientNameTitleCase((draft.lastName ?? "").trim());
  const ref = nextClientCode(clients);
  return {
    ref,
    alta: clientCreationDate(),
    name,
    lastName,
    document: `S/${ref.replace(/\D/g, "") || "0"}`,
    city: "",
    barrio: "",
    route: "",
    routeOrder: 0,
    email: "",
    phone: (draft.phone ?? "").trim(),
    address: "",
    notes: "Alta en calle (supervisor)",
    total: 0,
    pending: 0,
    status: CLIENT_STATUS_ACTIVE,
    kind: clientStatusKind(CLIENT_STATUS_ACTIVE),
    createdBy: draft.createdBy,
    awaitingLoan: true,
    profilePending: true,
  };
}

/** Inserta en el catálogo (sin colocar en ruta). */
export function insertStreetClient(clients: ClientRow[], row: ClientRow) {
  if (row.route.trim()) {
    return placeClientOnRoute(clients, row, row.route, row.routeOrder);
  }
  return [...clients, { ...row, route: "", routeOrder: 0 }];
}

export function buildQuickLoan(draft: QuickLoanDraft, client: ClientRow, loans: LoanRow[]): LoanRow | null {
  const startIso = todayIso();
  const preview = previewLoanFlat({
    capital: draft.capital,
    interest: draft.interest,
    startIso,
    frequency: draft.frequency,
    termMonths: draft.termMonths,
    installmentAmount:
      draft.installmentAmount != null && draft.installmentAmount > 0
        ? draft.installmentAmount
        : undefined,
  });
  if (!preview) return null;

  const dueIso = preview.dates[preview.dates.length - 1] ?? startIso;
  const ref = nextLoanCode(loans);
  const freqLabel =
    PAY_FREQUENCIES.find((item) => item.id === draft.frequency)?.label ?? draft.frequency;
  const termLabel =
    LOAN_TERM_OPTIONS.find((item) => item.id === draft.termMonths)?.label ?? `${draft.termMonths} mes`;

  const loan = syncLoan(
    {
      ref,
      clientRef: client.ref,
      client: `${client.name} ${client.lastName}`.trim(),
      date: isoToDisplay(startIso),
      due: isoToDisplay(dueIso),
      capital: draft.capital,
      paid: 0,
      balance: preview.total,
      status: "Activo",
      kind: "ok",
      notes: `Préstamo rápido · ${freqLabel} · ${termLabel}`,
      rate: draft.rate ?? (draft.capital > 0 ? (draft.interest / draft.capital) * 100 : 0),
      frequency: draft.frequency,
      mode: "cuota_fija",
      pact: "valor",
      days: preview.days,
      interest: preview.interest,
      total: preview.total,
      installment: preview.installment,
      schedule: preview.schedule,
      termsPending: true,
    },
    undefined,
  ) as LoanRow;

  if (draft.fundedBy === "efectivo") return markLoanFundedByEfectivo(loan);
  if (draft.fundedBy === "banco") return markLoanFundedByBanco(loan);
  return markLoanFundedByNequi(loan);
}

export function interestFromPct(capital: number, pct: number) {
  if (capital <= 0 || pct <= 0) return 0;
  return Math.trunc((capital * pct) / 100);
}

/** Cliente sin crédito abierto (puede volver a prestar). */
export function clientHasOpenLoan(clientRef: string, loans: LoanRow[]) {
  return loans.some(
    (loan) =>
      loan.clientRef === clientRef &&
      loan.status !== "Finalizado" &&
      Number(loan.balance ?? 0) > 0,
  );
}

/**
 * Elegibles para préstamo nuevo en una ruta:
 * - ya están en esa ruta, o
 * - están en catálogo sin ruta (alta pendiente de prestar).
 */
export function clientsEligibleForNewLoan(
  clients: ClientRow[],
  loans: LoanRow[],
  routeName?: string,
) {
  const route = (routeName ?? "").trim();
  return clients
    .filter((row) => {
      if (row.status === "Pte. revisión") return false;
      if (route) {
        const onRoute = row.route === route;
        const catalogOnly = !String(row.route || "").trim();
        if (!onRoute && !catalogOnly) return false;
      }
      return !clientHasOpenLoan(row.ref, loans);
    })
    .slice()
    .sort((a, b) => {
      const aUnassigned = !String(a.route || "").trim() ? 0 : 1;
      const bUnassigned = !String(b.route || "").trim() ? 0 : 1;
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned;
      const orderCmp = (a.routeOrder || 0) - (b.routeOrder || 0);
      if (orderCmp !== 0) return orderCmp;
      const nameA = `${a.name} ${a.lastName}`.trim().toLowerCase();
      const nameB = `${b.name} ${b.lastName}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, "es") || a.ref.localeCompare(b.ref);
    });
}

/** Tras prestar: coloca al cliente en la ruta (posición al final si venía del catálogo). */
export function assignClientToRouteOnLoan(
  clients: ClientRow[],
  client: ClientRow,
  routeName: string,
  patch: Partial<ClientRow>,
): ClientRow[] {
  const route = routeName.trim();
  const merged: ClientRow = { ...client, ...patch };
  if (!route) {
    return clients.map((row) => (row.ref === client.ref ? merged : row));
  }
  const order =
    client.route === route && client.routeOrder > 0
      ? client.routeOrder
      : nextRouteOrder(
          clients.filter((row) => row.ref !== client.ref),
          route,
        );
  return placeClientOnRoute(clients, merged, route, order);
}
