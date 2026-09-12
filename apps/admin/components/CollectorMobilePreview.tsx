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
import { collectorMobileQueue } from "@/lib/collector-mobile";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, RouteRow, UserRow } from "@/lib/mock-data";
import type { CollectorPaymentDraft } from "@/lib/route-sync";

const SUPERVISOR_ROLE_REF = "ROL-2";

type PreviewKind = "collector" | "supervisor";

type Props = {
  collectors: CollectorRow[];
  users?: UserRow[];
  selectedRef: string;
  onSelect: (ref: string) => void;
  /** Cambia cuando Workspace relee storage → remount del teléfono. */
  dataEpoch?: number;
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  payments: PaymentRow[];
  dayCloses?: CollectorDayCloseRecord[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  monthCloses?: CollectorMonthCloseRecord[];
  onRegisterPayment?: (draft: CollectorPaymentDraft) => boolean | void;
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
  dataEpoch = 0,
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
  /** Sube al cambiar persona → remount total (no hereda Recaudo/Historial). */
  const [panelEpoch, setPanelEpoch] = useState(0);

  const mobileCollectors = useMemo(
    () => collectors.filter((row) => row.mobileAccess && row.active),
    [collectors],
  );

  const today = todayIso();
  const closedByCollector = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of mobileCollectors) {
      const queue = collectorMobileQueue(
        row.ref,
        today,
        assignments,
        loans,
        clients,
        routes,
        dayCloses,
      );
      map.set(row.ref, queue.closed);
    }
    return map;
  }, [assignments, clients, dayCloses, loans, mobileCollectors, routes, today]);

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

  // Si el cobrador cambia desde fuera (Workspace), también remonta el panel.
  useEffect(() => {
    setPanelEpoch((n) => n + 1);
  }, [selectedRef]);

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
    setPanelEpoch((n) => n + 1);
    setSupervisorRef(ref);
  }

  const phoneTitle =
    kind === "supervisor"
      ? `${supervisor?.name ?? "Supervisor"} · app`
      : `${collector?.name ?? "Cobrador"} · app`;

  const collectorPanelKey = `cob-${collector?.ref ?? "x"}-${panelEpoch}-${dataEpoch}`;
  const supervisorPanelKey = `sup-${supervisor?.ref ?? "x"}-${panelEpoch}-${dataEpoch}`;

  return (
    <section className="panel collector-mobile-preview-panel is-compact">
      <div className="mobile-preview-layout">
        <div className="mobile-preview-phone-switcher" aria-label="Cambiar persona">
          <div className="mobile-preview-phone-switcher-row">
            <span className="mobile-preview-phone-switcher-label">Cobradores</span>
            <div className="mobile-preview-phone-switcher-chips">
              {mobileCollectors.length === 0 ? (
                <em className="mobile-preview-rail-empty">Sin cobradores</em>
              ) : (
                mobileCollectors.map((row) => {
                  const closed = closedByCollector.get(row.ref);
                  return (
                    <button
                      key={row.ref}
                      type="button"
                      className={
                        kind === "collector" && collector?.ref === row.ref
                          ? "mobile-preview-phone-chip is-active"
                          : "mobile-preview-phone-chip"
                      }
                      onClick={() => pickCollector(row.ref)}
                    >
                      {row.name}
                      {closed ? <i>Cerrado</i> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="mobile-preview-phone-switcher-row">
            <span className="mobile-preview-phone-switcher-label">Supervisor</span>
            <div className="mobile-preview-phone-switcher-chips">
              {supervisors.length === 0 ? (
                <em className="mobile-preview-rail-empty">Sin supervisores</em>
              ) : (
                supervisors.map((row) => (
                  <button
                    key={row.ref}
                    type="button"
                    className={
                      kind === "supervisor" && supervisor?.ref === row.ref
                        ? "mobile-preview-phone-chip is-active"
                        : "mobile-preview-phone-chip"
                    }
                    onClick={() => pickSupervisor(row.ref)}
                  >
                    {row.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <aside className="mobile-preview-rail">
          <h2>Cobradores</h2>
          {mobileCollectors.length === 0 ? (
            <p className="mobile-preview-rail-empty">Sin cobradores móviles</p>
          ) : (
            <ul className="mobile-preview-person-list">
              {mobileCollectors.map((row) => {
                const closed = closedByCollector.get(row.ref);
                return (
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
                      <span>{row.name}</span>
                      {closed ? <em className="mobile-preview-closed-tag">Cerrado</em> : null}
                    </button>
                  </li>
                );
              })}
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
                  key={supervisorPanelKey}
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
                  key={collectorPanelKey}
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
