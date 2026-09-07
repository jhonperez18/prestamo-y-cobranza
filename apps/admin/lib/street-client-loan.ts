import { CLIENT_STATUS_ACTIVE, clientStatusKind } from "@/lib/client-review";
import { nextRouteOrder, placeClientOnRoute } from "@/lib/client-route-order";
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

export type StreetClientDraft = {
  name: string;
  lastName?: string;
  phone?: string;
  /** Posición en la lista de la ruta (1…N). */
  routeOrder: number;
  routeName: string;
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
  /** Si el supervisor elige ruta, se asegura el cliente en esa ruta. */
  routeName?: string;
};

export const QUICK_INTEREST_PCT = [5, 10, 15, 20] as const;

export function buildStreetClient(
  draft: StreetClientDraft,
  clients: ClientRow[],
): ClientRow {
  const name = draft.name.trim();
  const lastName = (draft.lastName ?? "").trim();
  const routeName = draft.routeName.trim();
  const ref = nextClientCode(clients);
  const maxPos = nextRouteOrder(clients, routeName);
  const order = Math.min(Math.max(1, Math.trunc(draft.routeOrder) || maxPos), maxPos);
  return {
    ref,
    alta: clientCreationDate(),
    name,
    lastName,
    document: `S/${ref.replace(/\D/g, "") || "0"}`,
    city: "",
    barrio: "",
    route: routeName,
    routeOrder: order,
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

export function insertStreetClient(clients: ClientRow[], row: ClientRow) {
  return placeClientOnRoute(clients, row, row.route, row.routeOrder);
}

export function buildQuickLoan(draft: QuickLoanDraft, client: ClientRow, loans: LoanRow[]): LoanRow | null {
  const startIso = todayIso();
  const preview = previewLoanFlat({
    capital: draft.capital,
    interest: draft.interest,
    startIso,
    frequency: draft.frequency,
    termMonths: draft.termMonths,
  });
  if (!preview) return null;

  const dueIso = preview.dates[preview.dates.length - 1] ?? startIso;
  const ref = nextLoanCode(loans);
  const freqLabel =
    PAY_FREQUENCIES.find((item) => item.id === draft.frequency)?.label ?? draft.frequency;
  const termLabel =
    LOAN_TERM_OPTIONS.find((item) => item.id === draft.termMonths)?.label ?? `${draft.termMonths} mes`;

  return syncLoan(
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

/** Clientes del sistema elegibles para un préstamo nuevo (ruta opcional). */
export function clientsEligibleForNewLoan(
  clients: ClientRow[],
  loans: LoanRow[],
  routeName?: string,
) {
  const route = (routeName ?? "").trim();
  return clients
    .filter((row) => {
      if (route && row.route !== route) return false;
      if (row.awaitingLoan) return false;
      if (row.status === "Pte. revisión") return false;
      return !clientHasOpenLoan(row.ref, loans);
    })
    .slice()
    .sort((a, b) => {
      const orderCmp = (a.routeOrder || 0) - (b.routeOrder || 0);
      if (orderCmp !== 0) return orderCmp;
      const nameA = `${a.name} ${a.lastName}`.trim().toLowerCase();
      const nameB = `${b.name} ${b.lastName}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, "es") || a.ref.localeCompare(b.ref);
    });
}
