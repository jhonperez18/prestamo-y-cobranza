"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CollectorMobileApp,
  type CollectorCloseDayPayload,
  type CollectorCloseMonthPayload,
  type CollectorSaveExpensesPayload,
  type CollectorSkipVisitDraft,
} from "@/components/CollectorMobileApp";
import { MobilePreviewFrame } from "@/components/MobilePreviewFrame";
import { SupervisorMobileApp } from "@/components/SupervisorMobileApp";
import { collectorDayClosedFromStore } from "@/lib/collector-mobile";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import type { RenewalTerms } from "@/lib/loan-renew";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, RouteRow, UserRow } from "@/lib/mock-data";
import type { CollectorPaymentRegisterInput } from "@/lib/route-sync";

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
  planillaCashCloses?: import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[];
  onRegisterPayment?: (
    draft: CollectorPaymentRegisterInput,
  ) => boolean | void | Promise<boolean | void>;
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onRenewLoan?: (loanRef: string, terms: RenewalTerms) => void;
  onSaveExpenses?: (payload: CollectorSaveExpensesPayload) => void;
  onCloseDay?: (payload: CollectorCloseDayPayload) => boolean | void | Promise<boolean | void>;
  onCloseMonth?: (payload: CollectorCloseMonthPayload) => void;
  onCreateQuickLoan?: (draft: import("@/lib/street-client-loan").QuickLoanDraft) => void;
  onCreateRouteClient?: (
    draft: import("@/lib/commit-portfolio-catalog").RouteClientDraft,
    createdBy?: string,
  ) => Promise<boolean | string>;
  onUpdateClient?: (draft: {
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
  }) => void;
  onAttachPaymentEvidence?: (
    paymentRef: string,
    evidence: import("@/lib/payment-evidence").PaymentEvidenceRef[],
  ) => void;
  bankAccounts?: import("@/lib/bank").BankAccount[];
  bankMovements?: import("@/lib/bank").BankMovement[];
  miscPayments?: import("@/lib/misc-payments").MiscPayment[];
  onSaveMiscPayment?: (payment: import("@/lib/misc-payments").MiscPayment) => void;
  onAdjustTCash?: (
    input: import("@/lib/commit-cash-adjustment").CashAdjustmentRequest,
  ) => Promise<boolean>;
  onReopenSheet?: (input: import("@/lib/save-sheet-reopen").SheetReopenRequest) => Promise<boolean>;
  onPreviewKindChange?: (kind: PreviewKind) => void;
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
  planillaCashCloses = [],
  onRegisterPayment,
  onSkipVisit,
  onRenewLoan,
  onSaveExpenses,
  onCloseDay,
  onCloseMonth,
  onCreateQuickLoan,
  onCreateRouteClient,
  onUpdateClient,
  onAttachPaymentEvidence,
  bankAccounts = [],
  bankMovements = [],
  miscPayments = [],
  onSaveMiscPayment,
  onAdjustTCash,
  onReopenSheet,
  onPreviewKindChange,
}: Props) {
  /** En celular admin: una sola vista. En PC: las 3 a la vez. */
  const [kind, setKind] = useState<PreviewKind>("collector");
  const [supervisorRef, setSupervisorRef] = useState("");

  useEffect(() => {
    onPreviewKindChange?.(kind);
  }, [kind, onPreviewKindChange]);

  const mobileCollectors = useMemo(
    () => collectors.filter((row) => row.mobileAccess && row.active),
    [collectors],
  );

  const today = todayIso();
  const closedByCollector = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of mobileCollectors) {
      map.set(
        row.ref,
        collectorDayClosedFromStore(row.ref, today, assignments, dayCloses, loans, clients),
      );
    }
    return map;
  }, [assignments, clients, dayCloses, loans, mobileCollectors, today]);

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
    if (supervisor && supervisor.ref !== supervisorRef) {
      setSupervisorRef(supervisor.ref);
    }
  }, [supervisor, supervisorRef]);

  function pickCollector(ref: string) {
    setKind("collector");
    if (ref !== selectedRef) onSelect(ref);
  }

  function pickSupervisor(ref: string) {
    setSupervisorRef(ref);
    setKind("supervisor");
  }

  function renderCollectorPhone(row: CollectorRow) {
    return (
      <MobilePreviewFrame key={`frame-cob-${row.ref}`} title={`${row.name} · cobrador`}>
        <CollectorMobileApp
          key={`cob-${row.ref}`}
          collector={row}
          assignments={assignments}
          routes={routes}
          loans={loans}
          clients={clients}
          payments={payments}
          dayCloses={dayCloses}
          dayExpenseDrafts={dayExpenseDrafts}
          monthCloses={monthCloses}
          planillaCashCloses={planillaCashCloses}
          preview
          canRegister
          onRegisterPayment={onRegisterPayment}
          onSkipVisit={onSkipVisit}
          onRenewLoan={onRenewLoan}
          onCreateQuickLoan={onCreateQuickLoan}
          onCreateClient={
            onCreateRouteClient ? (draft) => onCreateRouteClient(draft, row.name) : undefined
          }
          onSaveExpenses={onSaveExpenses}
          onCloseDay={onCloseDay}
          onCloseMonth={onCloseMonth}
        />
      </MobilePreviewFrame>
    );
  }

  function renderSupervisorPhone(row: UserRow) {
    return (
      <MobilePreviewFrame key={`frame-sup-${row.ref}`} title={`${row.name} · supervisor`}>
        <SupervisorMobileApp
          key={`sup-${row.ref}`}
          supervisor={row}
          collectors={collectors}
          routes={routes}
          clients={clients}
          loans={loans}
          payments={payments}
          assignments={assignments}
          dayExpenseDrafts={dayExpenseDrafts}
          dayCloses={dayCloses}
          monthCloses={monthCloses}
          planillaCashCloses={planillaCashCloses}
          bankAccounts={bankAccounts}
          bankMovements={bankMovements}
          miscPayments={miscPayments}
          showLifeline
          onCreateRouteClient={
            onCreateRouteClient
              ? (draft) => onCreateRouteClient(draft, row.name)
              : undefined
          }
          onCreateQuickLoan={onCreateQuickLoan}
          onRenewLoan={onRenewLoan}
          onUpdateClient={onUpdateClient}
          onAttachPaymentEvidence={onAttachPaymentEvidence}
          onSaveMiscPayment={onSaveMiscPayment}
          onAdjustTCash={onAdjustTCash}
          onReopenSheet={onReopenSheet}
        />
      </MobilePreviewFrame>
    );
  }

  return (
    <section className="panel collector-mobile-preview-panel is-compact">
      {/* —— PC: Yesid + Edgar + Supervisor a la vez —— */}
      <div className="mobile-preview-triple-pc" aria-label="Vistas móviles en PC">
        <p className="mobile-preview-triple-pc-note">
          PC · tres vistas a la vez (cobradores + supervisor). En el celular real cada uno ve la
          suya.
        </p>
        {mobileCollectors.length === 0 && !supervisor ? (
          <p className="ficha-empty">Crea cobradores con acceso móvil y un supervisor.</p>
        ) : (
          <div
            className="mobile-preview-triple-pc-grid"
            style={
              {
                ["--preview-cols" as string]: String(
                  Math.max(1, mobileCollectors.length + (supervisor ? 1 : 0)),
                ),
              } as CSSProperties
            }
          >
            {mobileCollectors.map((row) => (
              <div key={row.ref} className="mobile-preview-triple-pc-cell">
                <div className="mobile-preview-triple-pc-label">
                  <strong>{row.name}</strong>
                  <span>Cobrador</span>
                  {closedByCollector.get(row.ref) ? (
                    <em className="mobile-preview-closed-tag">Cerrado</em>
                  ) : null}
                </div>
                {renderCollectorPhone(row)}
              </div>
            ))}
            {supervisor ? (
              <div key={supervisor.ref} className="mobile-preview-triple-pc-cell">
                <div className="mobile-preview-triple-pc-label">
                  <strong>{supervisor.name}</strong>
                  <span>Supervisor</span>
                </div>
                {renderSupervisorPhone(supervisor)}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* —— Celular admin: una sola vista (switcher) —— */}
      <div className="mobile-preview-layout is-phone-single">
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
          {kind === "collector" && collector
            ? renderCollectorPhone(collector)
            : kind === "supervisor" && supervisor
              ? renderSupervisorPhone(supervisor)
              : (
                <p className="ficha-empty">
                  {kind === "supervisor"
                    ? "Crea un usuario con rol Supervisor para previsualizar."
                    : "Crea un usuario cobrador con acceso móvil."}
                </p>
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
