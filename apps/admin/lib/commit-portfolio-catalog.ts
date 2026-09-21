/**
 * Commit atómico de cartera operativa (misma ley que personas / PG-):
 * cliente / préstamo → persistir raíz → planilla → cola nube → await flush.
 */
import type { ModuleId } from "@/lib/navigation";
import { placeClientOnRoute } from "@/lib/client-route-order";
import {
  CLIENT_STATUS_ACTIVE,
  CLIENT_STATUS_REVIEW,
  clientStatusKind,
  isPendingReview,
} from "@/lib/client-review";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import {
  DEMO_CLIENTS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_ROUTES_KEY,
  writeDemoJson,
} from "@/lib/demo-persist";
import { syncLoan } from "@/lib/loan-preview";
import {
  clientCreationDate,
  loansForClient,
  nextClientCode,
  nextLoanCode,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { markLoanFundedByBanco, markLoanFundedByNequi } from "@/lib/nequi-pool";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import {
  flushCatalogMirrorQueues,
  queueClientMirror,
  queueLoanMirror,
} from "@/lib/supabase/catalog-mirror";
import {
  flushOpsMirrorQueues,
  queueAssignmentsMirror,
  queueRoutesMirror,
} from "@/lib/supabase/ops-mirror";

export type PortfolioClientDraft = {
  name: string;
  lastName: string;
  nickname: string;
  document: string;
  route: string;
  routeOrder: number;
  email: string;
  city: string;
  barrio: string;
  address: string;
  notes: string;
  photo?: string;
};

export type PortfolioLoanDraft = {
  clientRef: string;
  capital: number;
  date: string;
  due: string;
  notes: string;
  rate: number;
  frequency: LoanRow["frequency"];
  mode: LoanRow["mode"];
  pact: LoanRow["pact"];
  days: number;
  interest: number;
  total: number;
  installment: number;
  schedule: LoanRow["schedule"];
  fundedBy?: "nequi" | "banco";
};

export type PortfolioCatalogState = {
  clients: ClientRow[];
  loans: LoanRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  collectors: CollectorRow[];
  payments: PaymentRow[];
};

export type PortfolioCommitResult =
  | { ok: false; error: string }
  | {
      ok: true;
      state: PortfolioCatalogState;
      message: string;
      focusClientRef?: string;
      focusLoanRef?: string;
      goTo?: { moduleId: ModuleId; viewId: string };
    };

function persistPortfolio(state: PortfolioCatalogState) {
  writeDemoJson(DEMO_CLIENTS_KEY, state.clients);
  writeDemoJson(DEMO_LOANS_KEY, state.loans);
  writeDemoJson(DEMO_ROUTES_KEY, state.routes);
  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, state.assignments);
}

function projectPlanilla(
  state: PortfolioCatalogState,
  date = todayIso(),
): PortfolioCatalogState {
  const synced = syncPermanentRoutePlanilla(
    date,
    state.routes,
    state.clients,
    state.loans,
    state.collectors,
    state.assignments,
    state.payments,
  );
  return {
    ...state,
    routes: synced.routes,
    assignments: synced.assignments,
  };
}

function enqueuePortfolioMirrors(
  state: PortfolioCatalogState,
  opts: { clientRefs?: string[]; loanRefs?: string[]; mirrorPlanilla?: boolean },
) {
  for (const ref of opts.clientRefs ?? []) {
    const row = state.clients.find((entry) => entry.ref === ref);
    if (row) queueClientMirror(row);
  }
  for (const ref of opts.loanRefs ?? []) {
    const row = state.loans.find((entry) => entry.ref === ref);
    if (row) queueLoanMirror(row);
  }
  if (opts.mirrorPlanilla) {
    queueRoutesMirror(state.routes);
    queueAssignmentsMirror(state.assignments);
  }
}

export async function flushPortfolioCatalogToCloud() {
  await flushCatalogMirrorQueues();
  await flushOpsMirrorQueues();
}

export function commitCreateClient(
  draft: PortfolioClientDraft,
  state: PortfolioCatalogState,
  opts: { canApprove: boolean; createdBy?: string },
): PortfolioCommitResult {
  const name = draft.name.trim();
  const lastName = draft.lastName.trim();
  if (!name) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const review = opts.canApprove
    ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
    : { status: CLIENT_STATUS_REVIEW, kind: clientStatusKind(CLIENT_STATUS_REVIEW) };

  const ref = nextClientCode(state.clients);
  const row: ClientRow = {
    ref,
    alta: clientCreationDate(),
    name,
    lastName,
    nickname: draft.nickname,
    document: draft.document,
    city: draft.city,
    barrio: draft.barrio,
    route: review.status === CLIENT_STATUS_REVIEW ? "" : draft.route,
    routeOrder: review.status === CLIENT_STATUS_REVIEW ? 0 : draft.routeOrder,
    email: draft.email,
    phone: "",
    address: draft.address,
    notes: draft.notes,
    photo: draft.photo,
    total: 0,
    pending: 0,
    status: review.status,
    kind: review.kind,
    createdBy: opts.createdBy,
  };

  const clients =
    review.status === CLIENT_STATUS_REVIEW
      ? [...state.clients, row]
      : placeClientOnRoute(state.clients, row, draft.route, draft.routeOrder);

  let next: PortfolioCatalogState = { ...state, clients };
  const mirrorPlanilla = review.status === CLIENT_STATUS_ACTIVE && Boolean(draft.route);
  if (mirrorPlanilla) next = projectPlanilla(next);

  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs: [ref],
    mirrorPlanilla,
  });

  if (review.status === CLIENT_STATUS_REVIEW) {
    return {
      ok: true,
      state: next,
      message: "Enviado a revisión. Aún no es cliente de ruta ni cobros.",
      focusClientRef: ref,
      goTo: { moduleId: "clientes", viewId: "revision" },
    };
  }

  return {
    ok: true,
    state: next,
    message: `Cliente creado en ruta ${draft.route}, posición ${draft.routeOrder}.`,
    focusClientRef: ref,
    goTo: { moduleId: "clientes", viewId: "ficha" },
  };
}

export function commitUpdateClient(
  clientRef: string,
  draft: PortfolioClientDraft,
  state: PortfolioCatalogState,
): PortfolioCommitResult {
  const openClient = state.clients.find((row) => row.ref === clientRef);
  if (!openClient) return { ok: false, error: "Cliente no encontrado." };

  const approving = isPendingReview(openClient);
  const doc = draft.document.trim();
  const hasRealDoc = Boolean(doc) && !doc.toUpperCase().startsWith("S/");
  const hasContactOrPlace = Boolean(
    openClient.phone?.trim() ||
      draft.address.trim() ||
      draft.city.trim() ||
      draft.barrio.trim(),
  );
  const profileComplete = hasRealDoc && hasContactOrPlace;
  const updated: ClientRow = {
    ...openClient,
    name: draft.name,
    lastName: draft.lastName,
    nickname: draft.nickname,
    document: draft.document,
    city: draft.city,
    barrio: draft.barrio,
    email: draft.email,
    address: draft.address,
    notes: draft.notes,
    photo: draft.photo,
    profilePending: profileComplete ? false : openClient.profilePending,
    ...(approving
      ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
      : {}),
  };

  const clients = placeClientOnRoute(state.clients, updated, draft.route, draft.routeOrder);
  let next: PortfolioCatalogState = { ...state, clients };
  next = projectPlanilla(next);
  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs: [clientRef],
    mirrorPlanilla: true,
  });

  if (approving) {
    return {
      ok: true,
      state: next,
      message: draft.route
        ? `Cliente aprobado en ruta ${draft.route} y cargado a la planilla.`
        : "Cliente aprobado y agregado al listado.",
      focusClientRef: clientRef,
      goTo: { moduleId: "clientes", viewId: "listado" },
    };
  }

  return {
    ok: true,
    state: next,
    message: updated.profilePending
      ? "Cliente actualizado. Aún faltan datos de ficha (alerta activa)."
      : "Cliente actualizado.",
    focusClientRef: clientRef,
    goTo: { moduleId: "clientes", viewId: "ficha" },
  };
}

export function commitRejectClients(
  refs: string[],
  state: PortfolioCatalogState,
): PortfolioCommitResult {
  if (!refs.length) return { ok: false, error: "No hay clientes para rechazar." };
  const pending = new Set(refs);
  const clients = state.clients.filter((row) => !pending.has(row.ref));
  let next: PortfolioCatalogState = { ...state, clients };
  next = projectPlanilla(next);
  persistPortfolio(next);
  enqueuePortfolioMirrors(next, { mirrorPlanilla: true });

  return {
    ok: true,
    state: next,
    message:
      refs.length === 1
        ? "Cliente rechazado y retirado de revisión."
        : `${refs.length} clientes rechazados.`,
    focusClientRef: clients[0]?.ref,
    goTo: { moduleId: "clientes", viewId: "revision" },
  };
}

export function commitDeleteClient(
  clientRef: string,
  state: PortfolioCatalogState,
): PortfolioCommitResult {
  const openClient = state.clients.find((row) => row.ref === clientRef);
  if (!openClient) return { ok: false, error: "Cliente no encontrado." };
  if (loansForClient(clientRef, state.loans).length > 0) {
    return { ok: false, error: "No se puede eliminar: el cliente tiene préstamos." };
  }
  const clients = state.clients.filter((row) => row.ref !== clientRef);
  let next: PortfolioCatalogState = { ...state, clients };
  next = projectPlanilla(next);
  persistPortfolio(next);
  enqueuePortfolioMirrors(next, { mirrorPlanilla: true });

  return {
    ok: true,
    state: next,
    message: "Cliente eliminado del listado.",
    focusClientRef: clients[0]?.ref,
    goTo: { moduleId: "clientes", viewId: "listado" },
  };
}

export function commitCreateLoan(
  draft: PortfolioLoanDraft,
  state: PortfolioCatalogState,
): PortfolioCommitResult {
  const client = state.clients.find((row) => row.ref === draft.clientRef);
  if (!client) return { ok: false, error: "Seleccione un cliente." };
  if (isPendingReview(client)) {
    return { ok: false, error: "No se puede prestar: el registro aún está en revisión." };
  }

  const ref = nextLoanCode(state.loans);
  const synced = syncLoan(
    {
      ref,
      clientRef: client.ref,
      client: `${client.name} ${client.lastName}`.trim(),
      date: draft.date,
      due: draft.due,
      capital: draft.capital,
      paid: 0,
      balance: draft.total,
      status: "Activo",
      kind: "ok",
      notes: draft.notes,
      rate: draft.rate,
      frequency: draft.frequency,
      mode: draft.mode,
      pact: draft.pact,
      days: draft.days,
      interest: draft.interest,
      total: draft.total,
      installment: draft.installment,
      schedule: draft.schedule,
    },
    state.payments,
  ) as LoanRow;
  const row =
    draft.fundedBy === "banco" ? markLoanFundedByBanco(synced) : markLoanFundedByNequi(synced);
  const nextClient: ClientRow = {
    ...client,
    total: client.total + draft.total,
    pending: client.pending + draft.total,
  };
  const clients = state.clients.map((entry) =>
    entry.ref === client.ref ? nextClient : entry,
  );
  const loans = [row, ...state.loans];
  let next: PortfolioCatalogState = { ...state, clients, loans };
  next = projectPlanilla(next);
  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs: [client.ref],
    loanRefs: [ref],
    mirrorPlanilla: true,
  });

  return {
    ok: true,
    state: next,
    message: "Préstamo creado y cargado a la planilla.",
    focusClientRef: client.ref,
    focusLoanRef: ref,
    goTo: { moduleId: "prestamos", viewId: "cuenta" },
  };
}

export function commitUpdateLoan(
  loanRef: string,
  draft: PortfolioLoanDraft,
  state: PortfolioCatalogState,
): PortfolioCommitResult {
  const openLoan = state.loans.find((row) => row.ref === loanRef);
  if (!openLoan) return { ok: false, error: "Préstamo no encontrado." };
  const client = state.clients.find((row) => row.ref === draft.clientRef);
  if (!client) return { ok: false, error: "Seleccione un cliente." };

  const oldTotal = openLoan.total ?? openLoan.capital;
  const nextLoan = syncLoan(
    {
      ...openLoan,
      clientRef: client.ref,
      client: `${client.name} ${client.lastName}`.trim(),
      date: draft.date,
      due: draft.due,
      capital: draft.capital,
      paid: openLoan.paid,
      notes: draft.notes,
      rate: draft.rate,
      frequency: draft.frequency,
      mode: draft.mode,
      pact: draft.pact,
      days: draft.days,
      interest: draft.interest,
      total: draft.total,
      installment: draft.installment,
      schedule: draft.schedule,
      termsPending: false,
    },
    state.payments,
  ) as LoanRow;
  const nextClient: ClientRow = {
    ...client,
    total: Math.max(0, client.total - oldTotal + draft.total),
    pending: Math.max(0, client.pending - oldTotal + draft.total),
  };
  const loans = state.loans.map((row) => (row.ref === loanRef ? nextLoan : row));
  const clients = state.clients.map((entry) =>
    entry.ref === client.ref ? nextClient : entry,
  );
  let next: PortfolioCatalogState = { ...state, clients, loans };
  next = projectPlanilla(next);
  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs: [client.ref],
    loanRefs: [loanRef],
    mirrorPlanilla: true,
  });

  return {
    ok: true,
    state: next,
    message: openLoan.termsPending
      ? "Préstamo actualizado. Ya no aparece en alertas de revisión."
      : "Préstamo actualizado.",
    focusClientRef: client.ref,
    focusLoanRef: loanRef,
    goTo: { moduleId: "prestamos", viewId: "cuenta" },
  };
}
