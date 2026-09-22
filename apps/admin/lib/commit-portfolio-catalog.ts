/**
 * Commit atómico de cartera operativa (misma ley que personas / PG-):
 * cliente / préstamo → persistir raíz → planilla → cola nube → await flush.
 */
import type { ModuleId } from "@/lib/navigation";
import {
  placeClientOnRoute,
  nextRouteOrder,
  clientRefsWithRouteOrderChange,
  sameRoute,
} from "@/lib/client-route-order";
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
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  writeDemoJson,
} from "@/lib/demo-persist";
import { mergeSchedulePaid, syncLoan } from "@/lib/loan-preview";
import {
  catalogRoutes,
  clientCreationDate,
  loansForClient,
  nextClientCode,
  nextLoanCode,
  normalizeRouteNumber,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { markLoanFundedByBanco, markLoanFundedByEfectivo, markLoanFundedByNequi } from "@/lib/nequi-pool";
import { resolvedLoanInstallment, syncPermanentRoutePlanilla } from "@/lib/route-planilla";
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
import { queuePaymentMirror, flushPaymentMirrorQueue } from "@/lib/supabase/payment-mirror";

/** El acuerdo del formulario manda: interés 0, # cuotas y cuota manual no se reescriben. */
function pinLoanDraftAgreement(synced: LoanRow, draft: PortfolioLoanDraft): LoanRow {
  const schedule =
    draft.schedule && draft.schedule.length > 0
      ? mergeSchedulePaid(
          draft.schedule.map((line) => ({
            date: line.date,
            amount: line.amount,
            kind: line.kind ?? "cuota",
          })),
          synced.schedule,
        )
      : synced.schedule;
  const interest = Number.isFinite(draft.interest) ? Math.max(0, Math.trunc(draft.interest)) : 0;
  const total =
    Number.isFinite(draft.total) && draft.total > 0
      ? Math.trunc(draft.total)
      : Math.trunc(draft.capital) + interest;
  const paid = synced.paid ?? 0;
  return {
    ...synced,
    days: draft.days > 0 ? Math.trunc(draft.days) : synced.days,
    interest,
    total,
    installment:
      Number.isFinite(draft.installment) && draft.installment > 0
        ? Math.trunc(draft.installment)
        : synced.installment,
    schedule,
    due: draft.due || synced.due,
    mode: "cuota_fija",
    pact: "valor",
    rate: draft.rate ?? 0,
    frequency: draft.frequency ?? synced.frequency,
    balance: Math.max(0, total - paid),
  };
}

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
  /** Celular / contacto (supervisor móvil y ficha). */
  phone?: string;
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
  fundedBy?: "nequi" | "banco" | "efectivo";
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
  writeDemoJson(DEMO_PAYMENTS_KEY, state.payments);
}

function clientDisplayName(client: Pick<ClientRow, "name" | "lastName">) {
  return `${client.name} ${client.lastName}`.trim();
}

/**
 * Renombrar cliente = proyectar identidad a préstamos, planilla y PG-.
 * Sin esto el nombre queda viejo en cobros y un PG ajeno puede “pegarse”.
 */
function projectClientIdentity(
  state: PortfolioCatalogState,
  clientRef: string,
  label: string,
): PortfolioCatalogState {
  const loanRefs = new Set(
    state.loans.filter((row) => row.clientRef === clientRef).map((row) => row.ref),
  );
  const loans = state.loans.map((row) =>
    row.clientRef === clientRef ? { ...row, client: label } : row,
  );
  const assignments = state.assignments.map((row) =>
    row.clientRef === clientRef ? { ...row, clientName: label } : row,
  );
  const payments = state.payments.map((row) =>
    row.loanRef && loanRefs.has(row.loanRef) ? { ...row, client: label } : row,
  );
  return { ...state, loans, assignments, payments };
}

function stampCatalogRow<T>(row: T): T {
  return { ...row, updatedAt: new Date().toISOString() };
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
  opts: {
    clientRefs?: string[];
    loanRefs?: string[];
    paymentRefs?: string[];
    mirrorPlanilla?: boolean;
  },
) {
  for (const ref of opts.clientRefs ?? []) {
    const row = state.clients.find((entry) => entry.ref === ref);
    if (row) queueClientMirror(row);
  }
  for (const ref of opts.loanRefs ?? []) {
    const row = state.loans.find((entry) => entry.ref === ref);
    if (row) queueLoanMirror(row);
  }
  for (const ref of opts.paymentRefs ?? []) {
    const row = state.payments.find((entry) => entry.ref === ref);
    if (row) void queuePaymentMirror(row);
  }
  if (opts.mirrorPlanilla) {
    queueRoutesMirror(state.routes);
    queueAssignmentsMirror(state.assignments);
  }
}

export async function flushPortfolioCatalogToCloud() {
  await flushCatalogMirrorQueues();
  await flushOpsMirrorQueues();
  await flushPaymentMirrorQueue();
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
  const row = stampCatalogRow({
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
  } as ClientRow);

  const clients =
    review.status === CLIENT_STATUS_REVIEW
      ? [...state.clients, row]
      : placeClientOnRoute(state.clients, row, draft.route, draft.routeOrder);

  let next: PortfolioCatalogState = { ...state, clients };
  const mirrorPlanilla = review.status === CLIENT_STATUS_ACTIVE && Boolean(draft.route);
  if (mirrorPlanilla) next = projectPlanilla(next);

  const routeTouchedRefs =
    review.status === CLIENT_STATUS_REVIEW
      ? [ref]
      : clientRefsWithRouteOrderChange(state.clients, next.clients);
  const clientRefs = Array.from(new Set([ref, ...routeTouchedRefs]));

  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs,
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
    (draft.phone !== undefined ? draft.phone.trim() : openClient.phone?.trim()) ||
      draft.address.trim() ||
      draft.city.trim() ||
      draft.barrio.trim(),
  );
  // Documento/cédula es opcional: la ficha se completa con contacto o lugar.
  const profileComplete = hasContactOrPlace || hasRealDoc;
  const updated = stampCatalogRow({
    ...openClient,
    name: draft.name.trim(),
    lastName: draft.lastName.trim(),
    nickname: draft.nickname.trim(),
    document: draft.document,
    city: draft.city,
    barrio: draft.barrio,
    email: draft.email,
    address: draft.address,
    notes: draft.notes,
    photo: draft.photo,
    ...(draft.phone !== undefined ? { phone: draft.phone.trim() } : {}),
    profilePending: profileComplete ? false : openClient.profilePending,
    ...(approving
      ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
      : {}),
  });

  // Posición sagrada: si no cambia ruta/#, no reordenar vecinos (solo ficha).
  const keepSlot =
    !approving &&
    !isPendingReview(openClient) &&
    sameRoute(openClient.route, draft.route) &&
    Number(openClient.routeOrder) > 0 &&
    Number(openClient.routeOrder) === Number(draft.routeOrder);

  const clients = keepSlot
    ? state.clients.map((row) =>
        row.ref === clientRef
          ? stampCatalogRow({
              ...updated,
              route: openClient.route,
              routeOrder: openClient.routeOrder,
            })
          : row,
      )
    : placeClientOnRoute(state.clients, updated, draft.route, draft.routeOrder);
  const placed = clients.find((row) => row.ref === clientRef) ?? updated;
  const label = clientDisplayName(updated);
  const prevLabel = clientDisplayName(openClient);
  let next: PortfolioCatalogState = { ...state, clients };
  // Siempre proyecta: corrige préstamos/planilla/PG con nombre viejo tras un rename.
  next = projectClientIdentity(next, clientRef, label);
  next = projectPlanilla(next);

  const loanRefs = next.loans
    .filter((row) => row.clientRef === clientRef)
    .map((row) => row.ref);
  const paymentRefs = next.payments
    .filter((row) => row.loanRef && loanRefs.includes(row.loanRef))
    .map((row) => row.ref);
  // Toda la ruta cuya # cambió: mirror obligatorio (no solo el editado).
  const routeTouchedRefs = clientRefsWithRouteOrderChange(state.clients, next.clients);
  const clientRefs = Array.from(new Set([clientRef, ...routeTouchedRefs]));

  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs,
    loanRefs,
    paymentRefs: label !== prevLabel || paymentRefs.length ? paymentRefs : [],
    mirrorPlanilla: true,
  });

  if (approving) {
    return {
      ok: true,
      state: next,
      message: draft.route
        ? `Cliente aprobado en ruta ${draft.route}, posición ${placed.routeOrder}, planilla actualizada.`
        : "Cliente aprobado y agregado al listado.",
      focusClientRef: clientRef,
      goTo: { moduleId: "clientes", viewId: "listado" },
    };
  }

  return {
    ok: true,
    state: next,
    message: updated.profilePending
      ? `Cliente actualizado · posición ${placed.routeOrder}. Aún faltan datos de ficha.`
      : `Cliente actualizado · ruta ${placed.route || "—"}, posición ${placed.routeOrder}. Planilla al día.`,
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
  const pinned = pinLoanDraftAgreement(synced, draft);
  const installment = Math.max(
    Number(pinned.installment) || 0,
    resolvedLoanInstallment(pinned),
    Number(draft.installment) || 0,
  );
  const loanReady = stampCatalogRow({
    ...pinned,
    installment: installment > 0 ? installment : pinned.installment,
    balance: Math.max(0, Number(pinned.total) || Number(draft.total) || Number(draft.capital) || 0),
  });
  const row = stampCatalogRow(
    draft.fundedBy === "banco"
      ? markLoanFundedByBanco(loanReady)
      : draft.fundedBy === "efectivo"
        ? markLoanFundedByEfectivo(loanReady)
        : markLoanFundedByNequi(loanReady),
  );

  // Asegura al cliente en su ruta (misma que el cobrador de esa ruta).
  const routeName =
    normalizeRouteNumber(client.route) || String(client.route || "").trim();
  const catalogRoute = catalogRoutes(state.routes).find(
    (entry) =>
      routeIsActive(entry) &&
      (normalizeRouteNumber(entry.name) === routeName || entry.name === client.route),
  );
  const routeForClient = catalogRoute?.name || routeName || client.route;
  const order =
    client.routeOrder > 0 &&
    (normalizeRouteNumber(client.route) === normalizeRouteNumber(routeForClient) ||
      client.route === routeForClient)
      ? client.routeOrder
      : nextRouteOrder(
          state.clients.filter((entry) => entry.ref !== client.ref),
          routeForClient,
        );
  const nextClientBase = stampCatalogRow({
    ...client,
    total: client.total + draft.total,
    pending: client.pending + draft.total,
    awaitingLoan: false,
  });
  const clients = routeForClient
    ? placeClientOnRoute(state.clients, nextClientBase, routeForClient, order)
    : state.clients.map((entry) => (entry.ref === client.ref ? nextClientBase : entry));

  const loans = [row, ...state.loans];
  let next: PortfolioCatalogState = { ...state, clients, loans };
  next = projectPlanilla(next);

  // Si aún no quedó en planilla de hoy, regenera una vez más (ruta/cobrador ya alineados).
  const today = todayIso();
  const onPlanilla = next.assignments.some(
    (entry) =>
      entry.loanRef === ref &&
      entry.dispatchDate === today &&
      !entry.dayClosedAt,
  );
  if (!onPlanilla) {
    next = projectPlanilla(next, today);
  }

  persistPortfolio(next);
  enqueuePortfolioMirrors(next, {
    clientRefs: [client.ref],
    loanRefs: [ref],
    mirrorPlanilla: true,
  });

  return {
    ok: true,
    state: next,
    message: onPlanilla || next.assignments.some((e) => e.loanRef === ref && e.dispatchDate === today)
      ? "Préstamo creado y cargado a la planilla del cobrador."
      : "Préstamo creado. Revise que la ruta del cliente tenga cobrador asignado.",
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
  const synced = syncLoan(
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
  const pinned = pinLoanDraftAgreement(synced, draft);
  const installment = Math.max(
    Number(pinned.installment) || 0,
    resolvedLoanInstallment(pinned),
    Number(draft.installment) || 0,
  );
  const fundedBase = stampCatalogRow({
    ...pinned,
    installment: installment > 0 ? installment : pinned.installment,
  });
  const funded =
    draft.fundedBy === "banco"
      ? markLoanFundedByBanco(fundedBase)
      : draft.fundedBy === "efectivo"
        ? markLoanFundedByEfectivo(fundedBase)
        : draft.fundedBy === "nequi"
          ? markLoanFundedByNequi(fundedBase)
          : fundedBase;
  const nextLoan = stampCatalogRow(funded);
  const nextClientBase = stampCatalogRow({
    ...client,
    total: Math.max(0, client.total - oldTotal + draft.total),
    pending: Math.max(0, client.pending - oldTotal + draft.total),
    awaitingLoan: false,
  });
  const routeName =
    normalizeRouteNumber(client.route) || String(client.route || "").trim();
  const catalogRoute = catalogRoutes(state.routes).find(
    (entry) =>
      routeIsActive(entry) &&
      (normalizeRouteNumber(entry.name) === routeName || entry.name === client.route),
  );
  const routeForClient = catalogRoute?.name || routeName || client.route;
  const order =
    client.routeOrder > 0 &&
    (normalizeRouteNumber(client.route) === normalizeRouteNumber(routeForClient) ||
      client.route === routeForClient)
      ? client.routeOrder
      : nextRouteOrder(
          state.clients.filter((entry) => entry.ref !== client.ref),
          routeForClient,
        );
  const loans = state.loans.map((row) => (row.ref === loanRef ? nextLoan : row));
  const clients = routeForClient
    ? placeClientOnRoute(state.clients, nextClientBase, routeForClient, order)
    : state.clients.map((entry) => (entry.ref === client.ref ? nextClientBase : entry));
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
      : next.assignments.some(
            (entry) => entry.loanRef === loanRef && entry.dispatchDate === todayIso(),
          )
        ? "Préstamo actualizado y en planilla del cobrador."
        : "Préstamo actualizado. Revise que la ruta tenga cobrador asignado.",
    focusClientRef: client.ref,
    focusLoanRef: loanRef,
    goTo: { moduleId: "prestamos", viewId: "cuenta" },
  };
}
