"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import { SupervisorMobileApp } from "@/components/SupervisorMobileApp";
import type { AppSession } from "@/lib/auth";
import {
  COLLECTORS,
  ROUTES,
  money,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
  type UserRow,
} from "@/lib/mock-data";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  DEMO_ROUTES_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  ensureBankAccounts,
  normalizeBankAccount,
  normalizeBankMovements,
  type BankAccount,
  type BankMovement,
} from "@/lib/bank";
import { syncBankLedger } from "@/lib/bank-ledger-sync";
import { queueClientMirror, queueLoanMirror, flushCatalogMirrorQueues } from "@/lib/supabase/catalog-mirror";
import { queuePaymentMirror } from "@/lib/supabase/payment-mirror";
import { rememberPaymentEvidence, withPaymentEvidence } from "@/lib/payment-evidence-store";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import { preferRicherEvidence } from "@/lib/payment-evidence";
import {
  CLIENT_STATUS_ACTIVE,
  clientStatusKind,
  isPendingReview,
} from "@/lib/client-review";
import {
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { COLLECTOR_DAILY_LOGS_SEED } from "@/lib/collector-daily-log";
import { todayIso } from "@/lib/daily-dispatch";
import { usePlanillaDayRollover } from "@/lib/planilla-day-sync";
import { type OperationalDemoSnapshot } from "@/lib/hydrate-operational-demo";
import { useOperationalDemoSync } from "@/lib/use-operational-demo-sync";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import {
  assignClientToRouteOnLoan,
  buildQuickLoan,
  buildStreetClient,
  insertStreetClient,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import {
  commitUpdateClient,
  flushPortfolioCatalogToCloud,
} from "@/lib/commit-portfolio-catalog";
import {
  flushOpsMirrorQueues,
  queueAssignmentsMirror,
  queueMiscPaymentMirror,
  queueRoutesMirror,
} from "@/lib/supabase/ops-mirror";
import { mirrorAutoDayCloseToCloud } from "@/lib/mirror-auto-day-close";
import type { MiscPayment } from "@/lib/misc-payments";

type Props = {
  session: AppSession;
  onLogout: () => void;
};

export function SupervisorShell({ session, onLogout }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [collectors, setCollectors] = useState(COLLECTORS);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [routes, setRoutes] = useState(ROUTES);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const [dailyLogs, setDailyLogs] = useState(COLLECTOR_DAILY_LOGS_SEED);
  const [dayCloses, setDayCloses] = useState<CollectorDayCloseRecord[]>([]);
  const [dayExpenseDrafts, setDayExpenseDrafts] = useState<CollectorDayExpenseDraft[]>([]);
  const [monthCloses, setMonthCloses] = useState<CollectorMonthCloseRecord[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [miscPayments, setMiscPayments] = useState<MiscPayment[]>([]);
  const { showToast, toastNode } = useActionToast();

  const supervisor = useMemo(
    () => users.find((row) => row.ref === session.userRef) ?? null,
    [users, session.userRef],
  );

  const applyOperationalSnapshot = useCallback((snap: OperationalDemoSnapshot) => {
    setUsers(snap.users);
    setCollectors(snap.collectors);
    setClients(snap.clients);
    setRoutes(snap.routes);
    setLoans(snap.loans);
    setPayments(snap.payments);
    setDailyAssignments(snap.assignments);
    setDayCloses(snap.dayCloses);
    setDayExpenseDrafts(snap.dayExpenseDrafts);
    setDailyLogs(snap.dailyLogs);
    setMonthCloses(snap.monthCloses);
    setBankAccounts(
      ensureBankAccounts(
        readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
      ),
    );
    setMiscPayments(readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []));
  }, []);

  const { hydrated } = useOperationalDemoSync(applyOperationalSnapshot, {
    onEvidenceSync: ({ pushed, failed }) => {
      if (pushed > 0) {
        showToast(
          pushed === 1
            ? "1 comprobante de este celular ya está en la nube."
            : `${pushed} comprobantes de este celular ya están en la nube.`,
        );
      } else if (failed > 0) {
        showToast("No se pudo subir el comprobante a la nube. Revisá la conexión.");
      }
    },
  });

  const applyPlanillaSync = useCallback(
    (next: {
      assignments: typeof dailyAssignments;
      routes: typeof routes;
      loans: typeof loans;
      logs: typeof dailyLogs;
      dayCloses: typeof dayCloses;
      dayExpenseDrafts: typeof dayExpenseDrafts;
      planillaCashCloses?: import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[];
      autoClosedCount: number;
    }) => {
      setDailyAssignments(next.assignments);
      setRoutes(next.routes);
      setLoans(next.loans);
      setDailyLogs(next.logs);
      setDayCloses(next.dayCloses);
      setDayExpenseDrafts(next.dayExpenseDrafts);
      if (next.planillaCashCloses) {
        writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, next.planillaCashCloses);
      }
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, next.assignments);
      queueAssignmentsMirror(next.assignments);
      writeDemoJson(DEMO_ROUTES_KEY, next.routes);
      writeDemoJson(DEMO_LOANS_KEY, next.loans);
      writeDemoJson(DEMO_DAILY_LOGS_KEY, next.logs);
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, next.dayCloses);
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next.dayExpenseDrafts);
      if (next.autoClosedCount > 0) {
        writeDemoJson(
          DEMO_BANK_MOVEMENTS_KEY,
          syncBankLedger({
            payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
            movements: normalizeBankMovements(
              readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
            ),
            accounts: ensureBankAccounts(
              readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
            ),
            miscPayments: readDemoJson(DEMO_MISC_PAYMENTS_KEY, []),
            dayExpenseDrafts: next.dayExpenseDrafts,
            dayCloses: next.dayCloses,
            loans: next.loans,
          }),
        );
        void mirrorAutoDayCloseToCloud({
          dayCloses: next.dayCloses,
          planillaCashCloses:
            next.planillaCashCloses ??
            readDemoJson<import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[]>(
              DEMO_PLANILLA_CASH_CLOSES_KEY,
              [],
            ),
          assignments: next.assignments,
        }).catch((error) => {
          console.error("auto-day-close-mirror", error);
        });
      }
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
      payments,
      dayCloses,
      dayExpenseDrafts,
      logs: dailyLogs,
      planillaCashCloses: readDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
      monthCloses,
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
    if (clients.length === 0) return;
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
  }) {
    const row = buildStreetClient(
      {
        name: draft.name,
        lastName: draft.lastName,
        phone: draft.phone,
        createdBy: session.name,
      },
      clients,
    );
    const nextClients = insertStreetClient(clients, row);
    setClients(nextClients);
    queueClientMirror(row);
    showToast(`Cliente ${row.name} guardado en el catálogo.`);
    void flushCatalogMirrorQueues().catch(() => {
      /* offline: queda en cola local */
    });
  }

  function updateClientFromMobile(draft: {
    ref: string;
    name: string;
    lastName: string;
    phone: string;
    document: string;
    address: string;
    city: string;
    barrio: string;
    notes: string;
    route: string;
    routeOrder: number;
  }) {
    const openClient = clients.find((row) => row.ref === draft.ref);
    if (!openClient) {
      showToast("Cliente no encontrado.");
      return;
    }
    const result = commitUpdateClient(
      draft.ref,
      {
        name: draft.name,
        lastName: draft.lastName,
        nickname: openClient.nickname ?? "",
        document: draft.document,
        route: draft.route,
        routeOrder: draft.routeOrder,
        email: openClient.email ?? "",
        city: draft.city,
        barrio: draft.barrio,
        address: draft.address,
        notes: draft.notes,
        photo: openClient.photo,
        phone: draft.phone,
      },
      {
        clients,
        loans,
        routes,
        assignments: dailyAssignments,
        collectors,
        payments,
      },
    );
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    setClients(result.state.clients);
    setLoans(result.state.loans);
    setRoutes(result.state.routes);
    setDailyAssignments(result.state.assignments);
    setPayments(result.state.payments.map((row) => withPaymentEvidence(row)));
    showToast("Guardando en el sistema…");
    void flushPortfolioCatalogToCloud()
      .then(() => showToast(result.message))
      .catch(() => showToast(`${result.message} (sin nube; en este aparato ya está).`));
  }

  async function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      showToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan(
      {
        ...draft,
        fundedBy: draft.fundedBy === "banco" ? "banco" : "nequi",
      },
      client,
      loans,
    );
    if (!loan) {
      showToast("Revise capital, interés, tiempo y frecuencia.");
      return;
    }
    const nextLoans = [loan, ...loans];
    const targetRoute = (draft.routeName ?? client.route).trim();
    const nextClients = assignClientToRouteOnLoan(clients, client, targetRoute, {
      awaitingLoan: false,
      status: CLIENT_STATUS_ACTIVE,
      kind: clientStatusKind(CLIENT_STATUS_ACTIVE),
      total: client.total + (loan.total ?? 0),
      pending: client.pending + (loan.total ?? 0),
    });
    setLoans(nextLoans);
    setClients(nextClients);
    writeDemoJson(DEMO_LOANS_KEY, nextLoans);
    writeDemoJson(DEMO_CLIENTS_KEY, nextClients);
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      nextLoans,
      collectors,
      dailyAssignments,
      payments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, planilla.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, planilla.routes);
    queueLoanMirror(loan);
    const mirroredClient = nextClients.find((entry) => entry.ref === client.ref);
    if (mirroredClient) queueClientMirror(mirroredClient);
    queueAssignmentsMirror(planilla.assignments);
    queueRoutesMirror(planilla.routes);
    writeDemoJson(
      DEMO_BANK_MOVEMENTS_KEY,
      syncBankLedger({
        payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
        movements: normalizeBankMovements(
          readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
        ),
        accounts: ensureBankAccounts(
          readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
        ),
        miscPayments: readDemoJson(DEMO_MISC_PAYMENTS_KEY, []),
        dayExpenseDrafts,
        dayCloses,
        loans: nextLoans,
      }),
    );
    showToast(
      `Préstamo ${loan.ref} · origen ${loan.fundedBy === "banco" ? "Banco" : "Nequi"} · subiendo…`,
    );
    try {
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
      showToast(
        `Préstamo ${loan.ref} listo · cuota ${money(loan.installment ?? 0)}.`,
      );
    } catch {
      showToast(
        `Préstamo ${loan.ref} guardado (sin nube; en este aparato ya está).`,
      );
    }
  }

  function saveMiscPaymentFromMobile(payment: MiscPayment) {
    const nextMisc = [
      ...miscPayments.filter((row) => row.ref !== payment.ref),
      payment,
    ];
    setMiscPayments(nextMisc);
    writeDemoJson(DEMO_MISC_PAYMENTS_KEY, nextMisc);
    const accounts = ensureBankAccounts(
      bankAccounts.length
        ? bankAccounts
        : readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(
      DEMO_BANK_MOVEMENTS_KEY,
      syncBankLedger({
        payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
        movements: normalizeBankMovements(
          readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
        ),
        accounts,
        miscPayments: nextMisc,
        dayExpenseDrafts,
        dayCloses,
        loans,
      }),
    );
    queueMiscPaymentMirror(payment);
    void flushOpsMirrorQueues().catch(() => {
      /* offline: queda en cola */
    });
    showToast(`Gasto ${payment.ref} guardado en registros.`);
  }

  function attachPaymentEvidence(paymentRef: string, evidence: PaymentEvidenceRef[]) {
    const ref = paymentRef.trim();
    if (!ref || !evidence.length) return;
    rememberPaymentEvidence(ref, evidence);
    setPayments((current) => {
      const next = current.map((row) => {
        if (row.ref !== ref) return row;
        const merged = preferRicherEvidence(evidence, row.evidence) ?? evidence;
        return withPaymentEvidence({ ...row, evidence: merged });
      });
      writeDemoJson(DEMO_PAYMENTS_KEY, next);
      const row = next.find((entry) => entry.ref === ref);
      if (row) queuePaymentMirror(row);
      return next;
    });
    showToast("Comprobante guardado · subiendo a la nube…");
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
        bankAccounts={bankAccounts}
        miscPayments={miscPayments}
        onCreateStreetClient={createStreetClientFromMobile}
        onCreateQuickLoan={createQuickLoanFromMobile}
        onUpdateClient={updateClientFromMobile}
        onAttachPaymentEvidence={attachPaymentEvidence}
        onSaveMiscPayment={saveMiscPaymentFromMobile}
        onLogout={onLogout}
      />
      {toastNode}
    </div>
  );
}
