"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import { SupervisorMobileApp } from "@/components/SupervisorMobileApp";
import type { AppSession } from "@/lib/auth";
import {
  CLIENTS,
  COLLECTORS,
  ROUTES,
  money,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
  type UserRow,
} from "@/lib/mock-data";
import {
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  CLIENT_STATUS_ACTIVE,
  clientStatusKind,
  normalizeClientLifecycle,
} from "@/lib/client-review";
import { dedupeClientsByRef, normalizeAllRouteOrders } from "@/lib/client-route-order";
import { rebuildDispatchRoutes } from "@/lib/collector-dispatch-sync";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { usePlanillaDayRollover } from "@/lib/planilla-day-sync";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import {
  buildQuickLoan,
  buildStreetClient,
  insertStreetClient,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";

type Props = {
  session: AppSession;
  onLogout: () => void;
};

export function SupervisorShell({ session, onLogout }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [collectors, setCollectors] = useState(COLLECTORS);
  const [clients, setClients] = useState(CLIENTS);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [routes, setRoutes] = useState(ROUTES);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const [dayCloses, setDayCloses] = useState<CollectorDayCloseRecord[]>([]);
  const [dayExpenseDrafts, setDayExpenseDrafts] = useState<CollectorDayExpenseDraft[]>([]);
  const [monthCloses, setMonthCloses] = useState<CollectorMonthCloseRecord[]>([]);
  const { showToast, toastNode } = useActionToast();

  const supervisor = useMemo(
    () => users.find((row) => row.ref === session.userRef) ?? null,
    [users, session.userRef],
  );

  useEffect(() => {
    const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
    const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS);
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
    const storedRoutes = readDemoJson(DEMO_ROUTES_KEY, ROUTES);
    const storedClients = normalizeAllRouteOrders(
      dedupeClientsByRef(
        readDemoJson(DEMO_CLIENTS_KEY, CLIENTS).map(normalizeClientLifecycle),
      ),
    );
    const loadedUsers = loadDemoUsers();
    setUsers(loadedUsers);
    setClients(storedClients);
    writeDemoJson(DEMO_CLIENTS_KEY, storedClients);
    setCollectors(storedCollectors);
    setPayments(storedPayments);
    setLoans(storedLoans);
    writeDemoJson(DEMO_PAYMENTS_KEY, storedPayments);
    const rebuilt = rebuildDispatchRoutes(
      storedRoutes,
      storedAssignments,
      storedCollectors,
      storedLoans,
      storedClients,
    );
    const synced = syncPermanentRoutePlanilla(
      todayIso(),
      rebuilt,
      storedClients,
      storedLoans,
      storedCollectors,
      storedAssignments,
    );
    setDailyAssignments(synced.assignments);
    setRoutes(synced.routes);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, synced.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, synced.routes);
    setDayCloses(readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []));
    setDayExpenseDrafts(
      readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
    );
    setMonthCloses(
      readDemoJson<CollectorMonthCloseRecord[]>(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []),
    );
    setHydrated(true);
  }, []);

  const applyPlanillaSync = useCallback(
    (next: { assignments: typeof dailyAssignments; routes: typeof routes }) => {
      setDailyAssignments(next.assignments);
      setRoutes(next.routes);
    },
    [],
  );

  usePlanillaDayRollover(
    hydrated,
    {
      routes,
      clients,
      loans,
      collectors,
      assignments: dailyAssignments,
    },
    applyPlanillaSync,
  );

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, dailyAssignments);
  }, [dailyAssignments, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, dayCloses);
  }, [dayCloses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, dayExpenseDrafts);
  }, [dayExpenseDrafts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, monthCloses);
  }, [monthCloses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_ROUTES_KEY, routes);
  }, [routes, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_PAYMENTS_KEY, payments);
  }, [payments, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_LOANS_KEY, loans);
  }, [loans, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_CLIENTS_KEY, clients);
  }, [clients, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTORS_KEY, collectors);
  }, [collectors, hydrated]);

  function createStreetClientFromMobile(draft: {
    name: string;
    lastName?: string;
    phone?: string;
    routeOrder: number;
    routeName: string;
    routeRef: string;
  }) {
    const row = buildStreetClient(
      {
        name: draft.name,
        lastName: draft.lastName,
        phone: draft.phone,
        routeOrder: draft.routeOrder,
        routeName: draft.routeName,
        createdBy: session.name,
      },
      clients,
    );
    const nextClients = insertStreetClient(clients, row);
    setClients(nextClients);
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      loans,
      collectors,
      dailyAssignments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    showToast(
      `Cliente ${row.name} en ruta ${draft.routeName}, posición ${row.routeOrder}: listo para prestar.`,
    );
  }

  function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      showToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan(draft, client, loans);
    if (!loan) {
      showToast("Revise capital, interés, tiempo y frecuencia.");
      return;
    }
    const nextLoans = [loan, ...loans];
    const targetRoute = (draft.routeName ?? client.route).trim() || client.route;
    const nextClients = clients.map((entry) =>
      entry.ref === client.ref
        ? {
            ...entry,
            awaitingLoan: false,
            status: CLIENT_STATUS_ACTIVE,
            kind: clientStatusKind(CLIENT_STATUS_ACTIVE),
            route: targetRoute,
            total: entry.total + (loan.total ?? 0),
            pending: entry.pending + (loan.total ?? 0),
          }
        : entry,
    );
    setLoans(nextLoans);
    setClients(nextClients);
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      nextLoans,
      collectors,
      dailyAssignments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    showToast(`Préstamo ${loan.ref} creado · cuota ${money(loan.installment ?? 0)}.`);
  }

  if (!hydrated) {
    return <div className="login-screen login-loading collector-shell-loading" aria-hidden />;
  }

  if (!supervisor) {
    return (
      <div className="collector-shell">
        <main className="collector-shell-main">
          <section className="panel access-denied">
            <div className="head">
              <h1>Supervisor no encontrado</h1>
            </div>
            <p className="access-denied-detail">
              No se pudo cargar el usuario supervisor. Cierra sesión e intenta de nuevo.
            </p>
            <button type="button" className="btn aside-logout" onClick={onLogout}>
              Cerrar sesión
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="collector-shell collector-shell-mobile">
      <SupervisorMobileApp
        supervisor={supervisor}
        collectors={collectors}
        routes={routes}
        clients={clients}
        loans={loans}
        payments={payments}
        assignments={dailyAssignments}
        dayExpenseDrafts={dayExpenseDrafts}
        dayCloses={dayCloses}
        monthCloses={monthCloses}
        onCreateStreetClient={createStreetClientFromMobile}
        onCreateQuickLoan={createQuickLoanFromMobile}
        onLogout={onLogout}
      />
      {toastNode}
    </div>
  );
}
