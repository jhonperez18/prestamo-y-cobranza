"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import {
  CLIENTS,
  COLLECTORS,
  ROUTES,
  nextPaymentCode,
  type PaymentRow,
} from "@/lib/mock-data";
import {
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { COLLECTOR_DAILY_LOGS_SEED, upsertDailyLogPayment } from "@/lib/collector-daily-log";
import {
  applyPaymentToAssignments,
  rebuildDispatchRoutes,
} from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { chargeLabel } from "@/lib/loan-preview";
import { buildPaymentRow } from "@/lib/payment-detail";
import { cuotaTarget, loanRowAfterPay } from "@/lib/loan-pay";
import { validatePaymentEvidence } from "@/lib/payment-evidence";
import { normalizePaymentMethod } from "@/lib/payment-method";
import { applyCollectorPaymentResult, type CollectorPaymentDraft } from "@/lib/route-sync";
import { CollectorMobileApp } from "@/components/CollectorMobileApp";
import type { AppSession } from "@/lib/auth";
import { hasPermission } from "@/lib/session-access";
import {
  assignmentsForMobileCollector,
  assertOwnCollectorPayment,
  routesForMobileCollector,
} from "@/lib/mobile-sync";
import { normalizeClientLifecycle } from "@/lib/client-review";

type Props = {
  session: AppSession;
  onLogout: () => void;
};

export function CollectorShell({ session, onLogout }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [collectors, setCollectors] = useState(COLLECTORS);
  const [clients, setClients] = useState(CLIENTS);
  const [loans, setLoans] = useState(() => loadDemoPaymentsBundle().loans);
  const [payments, setPayments] = useState<PaymentRow[]>(() => loadDemoPaymentsBundle().payments);
  const [routes, setRoutes] = useState(ROUTES);
  const [dailyLogs, setDailyLogs] = useState(COLLECTOR_DAILY_LOGS_SEED);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const { showToast, toastNode } = useActionToast();

  const collector = useMemo(() => {
    if (!session.collectorRef) return null;
    return collectors.find((row) => row.ref === session.collectorRef) ?? null;
  }, [collectors, session.collectorRef]);

  const myAssignments = useMemo(
    () =>
      session.collectorRef
        ? assignmentsForMobileCollector(session.collectorRef, dailyAssignments)
        : [],
    [dailyAssignments, session.collectorRef],
  );

  const myRoutes = useMemo(
    () => (session.collectorRef ? routesForMobileCollector(session.collectorRef, routes) : []),
    [routes, session.collectorRef],
  );

  useEffect(() => {
    const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS);
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
    const storedRoutes = readDemoJson(DEMO_ROUTES_KEY, ROUTES);
    const storedClients = readDemoJson(DEMO_CLIENTS_KEY, CLIENTS).map(normalizeClientLifecycle);
    const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
    loadDemoUsers();
    setClients(storedClients);
    setCollectors(storedCollectors);
    setPayments(storedPayments);
    setLoans(storedLoans);
    writeDemoJson(DEMO_PAYMENTS_KEY, storedPayments);
    setDailyAssignments(storedAssignments);
    setRoutes(rebuildDispatchRoutes(storedRoutes, storedAssignments, storedCollectors, storedLoans, storedClients));
    setDailyLogs(readDemoJson(DEMO_DAILY_LOGS_KEY, COLLECTOR_DAILY_LOGS_SEED));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, dailyAssignments);
  }, [dailyAssignments, hydrated]);

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
    writeDemoJson(DEMO_DAILY_LOGS_KEY, dailyLogs);
  }, [dailyLogs, hydrated]);

  function registerCollectorPayment(draft: CollectorPaymentDraft) {
    const ownershipError = assertOwnCollectorPayment(session.collectorRef, draft.collectorRef);
    if (ownershipError) {
      showToast(ownershipError);
      return;
    }

    const route = routes.find((row) => row.ref === draft.routeRef);
    const loan = loans.find((row) => row.ref === draft.loanRef);
    const keys = new Set(payments.map((row) => row.idempotencyKey).filter(Boolean) as string[]);

    if (keys.has(draft.idempotencyKey)) {
      showToast("Pago ya sincronizado (sin duplicar).");
      return;
    }

    const evidenceError = validatePaymentEvidence(draft.method, draft.evidence);
    if (evidenceError) {
      showToast(evidenceError);
      return;
    }

    const result = applyCollectorPaymentResult(loan!, draft, route!);
    if (!result.ok || !loan || !route) {
      showToast(!result.ok ? result.error : "No se pudo registrar el cobro.");
      return;
    }
    const pay = result.pay;

    const paymentRef = nextPaymentCode(payments);
    const dispatchDate = route.scheduledDate ?? todayIso();
    const paidTime = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const assignment = dailyAssignments.find(
      (row) =>
        row.loanRef === draft.loanRef &&
        row.collectorRef === draft.collectorRef &&
        row.dispatchDate === dispatchDate,
    );
    const payTarget = cuotaTarget(loan);
    const payment = buildPaymentRow(
      {
        ref: paymentRef,
        loanRef: draft.loanRef,
        when: `${isoToDispatchLabel(dispatchDate)} · ${paidTime}`,
        paidDate: dispatchDate,
        paidTime,
        dueDate: assignment?.chargeDate ?? payTarget?.date,
        chargeLabel: assignment?.chargeLabel ?? (payTarget?.kind ? chargeLabel(payTarget.kind) : undefined),
        client: draft.clientName,
        collector: draft.collectorName,
        collectorRef: draft.collectorRef,
        routeRef: draft.routeRef,
        idempotencyKey: draft.idempotencyKey,
        amount: draft.amount,
        type: pay.type,
        kind: "paid",
        method: normalizePaymentMethod(draft.method),
        evidence: draft.evidence?.length ? draft.evidence : undefined,
        source: "pwa",
        gps: true,
      },
      loan,
      pay,
    );

    const nextLoans = loans.map((row) =>
      row.ref === loan.ref ? loanRowAfterPay(row, pay, [payment, ...payments]) : row,
    );

    setPayments((current) => [payment, ...current]);
    setLoans(nextLoans);
    setDailyLogs((current) => upsertDailyLogPayment(current, payment, result.updatedRoute ?? route));
    setDailyAssignments((current) => applyPaymentToAssignments(current, payment, dispatchDate));
    setRoutes((current) =>
      current.map((row) => (row.ref === route.ref ? result.updatedRoute : row)),
    );
    setClients((current) =>
      current.map((entry) => {
        if (entry.ref !== draft.clientRef) return entry;
        return { ...entry, pending: Math.max(0, entry.pending - draft.amount) };
      }),
    );
    showToast(`Cobro ${paymentRef} guardado y sincronizado.`);
  }

  if (!hydrated) {
    return <div className="login-screen login-loading collector-shell-loading" aria-hidden />;
  }

  if (!collector) {
    return (
      <div className="collector-shell">
        <main className="collector-shell-main">
          <section className="panel access-denied">
            <div className="head">
              <h1>Sin cobrador vinculado</h1>
            </div>
            <p className="access-denied-detail">
              Este usuario no tiene un cobrador asociado. Pide al administrador que revise tu ficha.
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
      <CollectorMobileApp
        collector={collector}
        assignments={myAssignments}
        routes={myRoutes}
        loans={loans}
        clients={clients}
        canRegister={hasPermission(session, "cobros.registrar")}
        onRegisterPayment={
          hasPermission(session, "cobros.registrar") ? registerCollectorPayment : undefined
        }
        onLogout={onLogout}
      />
      {toastNode}
    </div>
  );
}
