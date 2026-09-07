"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CollectorMobileApp,
  type CollectorCloseDayPayload,
  type CollectorCloseMonthPayload,
  type CollectorSaveExpensesPayload,
  type CollectorSkipVisitDraft,
} from "@/components/CollectorMobileApp";
import { MobilePreviewFrame } from "@/components/MobilePreviewFrame";
import { SupervisorMobileApp } from "@/components/SupervisorMobileApp";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, RouteRow, UserRow } from "@/lib/mock-data";
import type { CollectorPaymentDraft } from "@/lib/route-sync";

const SUPERVISOR_ROLE_REF = "ROL-2";

type PreviewKind = "collector" | "supervisor";

type Props = {
  collectors: CollectorRow[];
  users?: UserRow[];
  selectedRef: string;
  onSelect: (ref: string) => void;
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  payments: PaymentRow[];
  dayCloses?: CollectorDayCloseRecord[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  monthCloses?: CollectorMonthCloseRecord[];
  onRegisterPayment?: (draft: CollectorPaymentDraft) => void;
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onRenewLoan?: (loanRef: string) => void;
  onSaveExpenses?: (payload: CollectorSaveExpensesPayload) => void;
  onCloseDay?: (payload: CollectorCloseDayPayload) => void;
  onCloseMonth?: (payload: CollectorCloseMonthPayload) => void;
  onCreateStreetClient?: (draft: {
    name: string;
    lastName?: string;
    phone?: string;
    routeOrder: number;
    routeName: string;
    routeRef: string;
  }) => void;
  onCreateQuickLoan?: (draft: import("@/lib/street-client-loan").QuickLoanDraft) => void;
};

export function CollectorMobilePreview({
  collectors,
  users = [],
  selectedRef,
  onSelect,
  assignments,
  routes,
  loans,
  clients,
  payments,
  dayCloses = [],
  dayExpenseDrafts = [],
  monthCloses = [],
  onRegisterPayment,
  onSkipVisit,
  onRenewLoan,
  onSaveExpenses,
  onCloseDay,
  onCloseMonth,
  onCreateStreetClient,
  onCreateQuickLoan,
}: Props) {
  const [kind, setKind] = useState<PreviewKind>("collector");
  const [supervisorRef, setSupervisorRef] = useState("");

  const mobileCollectors = useMemo(
    () => collectors.filter((row) => row.mobileAccess && row.active),
    [collectors],
  );

  const supervisors = useMemo(
    () =>
      users.filter(
        (row) =>
          row.active &&
          row.roleRef === SUPERVISOR_ROLE_REF &&
          (row.channels.includes("mobile") || row.channels.includes("admin")),
      ),
    [users],
  );

  const collector =
    mobileCollectors.find((row) => row.ref === selectedRef) ?? mobileCollectors[0] ?? null;

  const supervisor =
    supervisors.find((row) => row.ref === supervisorRef) ?? supervisors[0] ?? null;

  useEffect(() => {
    if (kind === "collector" && collector && collector.ref !== selectedRef) {
      onSelect(collector.ref);
    }
  }, [kind, collector, selectedRef, onSelect]);

  useEffect(() => {
    if (kind === "supervisor" && supervisor && supervisor.ref !== supervisorRef) {
      setSupervisorRef(supervisor.ref);
    }
  }, [kind, supervisor, supervisorRef]);

  function pickCollector(ref: string) {
    setKind("collector");
    onSelect(ref);
  }

  function pickSupervisor(ref: string) {
    setKind("supervisor");
    setSupervisorRef(ref);
  }

  const phoneTitle =
    kind === "supervisor"
      ? `${supervisor?.name ?? "Supervisor"} · app`
      : `${collector?.name ?? "Cobrador"} · app`;

  return (
    <section className="panel collector-mobile-preview-panel is-compact">
      <div className="mobile-preview-layout">
        <aside className="mobile-preview-rail">
          <h2>Cobradores</h2>
          {mobileCollectors.length === 0 ? (
            <p className="mobile-preview-rail-empty">Sin cobradores móviles</p>
          ) : (
            <ul className="mobile-preview-person-list">
              {mobileCollectors.map((row) => (
                <li key={row.ref}>
                  <button
                    type="button"
                    className={
                      kind === "collector" && collector?.ref === row.ref
                        ? "is-active"
                        : undefined
                    }
                    onClick={() => pickCollector(row.ref)}
                  >
                    {row.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="mobile-preview-stage">
          {kind === "collector" && !collector ? (
            <p className="ficha-empty">Crea un usuario cobrador con acceso móvil.</p>
          ) : kind === "supervisor" && !supervisor ? (
            <p className="ficha-empty">Crea un usuario con rol Supervisor para previsualizar.</p>
          ) : (
            <MobilePreviewFrame title={phoneTitle}>
              {kind === "supervisor" && supervisor ? (
                <SupervisorMobileApp
                  supervisor={supervisor}
                  collectors={collectors}
                  routes={routes}
                  clients={clients}
                  loans={loans}
                  payments={payments}
                  assignments={assignments}
                  dayExpenseDrafts={dayExpenseDrafts}
                  dayCloses={dayCloses}
                  monthCloses={monthCloses}
                  onCreateStreetClient={onCreateStreetClient}
                  onCreateQuickLoan={onCreateQuickLoan}
                />
              ) : collector ? (
                <CollectorMobileApp
                  collector={collector}
                  assignments={assignments}
                  routes={routes}
                  loans={loans}
                  clients={clients}
                  payments={payments}
                  dayCloses={dayCloses}
                  dayExpenseDrafts={dayExpenseDrafts}
                  monthCloses={monthCloses}
                  preview
                  canRegister
                  onRegisterPayment={onRegisterPayment}
                  onSkipVisit={onSkipVisit}
                  onRenewLoan={onRenewLoan}
                  onCreateQuickLoan={onCreateQuickLoan}
                  onSaveExpenses={onSaveExpenses}
                  onCloseDay={onCloseDay}
                  onCloseMonth={onCloseMonth}
                />
              ) : null}
            </MobilePreviewFrame>
          )}
        </div>

        <aside className="mobile-preview-rail">
          <h2>Supervisores</h2>
          {supervisors.length === 0 ? (
            <p className="mobile-preview-rail-empty">Sin supervisores</p>
          ) : (
            <ul className="mobile-preview-person-list">
              {supervisors.map((row) => (
                <li key={row.ref}>
                  <button
                    type="button"
                    className={
                      kind === "supervisor" && supervisor?.ref === row.ref
                        ? "is-active"
                        : undefined
                    }
                    onClick={() => pickSupervisor(row.ref)}
                  >
                    {row.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
