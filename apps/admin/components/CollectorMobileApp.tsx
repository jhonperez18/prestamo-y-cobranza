"use client";

import { useEffect, useMemo, useState } from "react";
import { CollectorPayForm } from "@/components/CollectorPayForm";
import { Pill } from "@/components/ui";
import {
  collectorMobileQueue,
  collectorMobileRoutes,
  defaultMobileRouteDate,
  visitStatusKind,
  visitStatusLabel,
} from "@/lib/collector-mobile";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { money, type ClientRow, type CollectorRow, type LoanRow, type RouteRow } from "@/lib/mock-data";
import type { CollectorPaymentDraft } from "@/lib/route-sync";

export type CollectorSkipVisitDraft = {
  routeRef: string;
  clientRef: string;
  loanRef: string;
  dispatchDate: string;
  collectorRef: string;
  reason?: string;
};

type Props = {
  collector: CollectorRow;
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  date?: string;
  preview?: boolean;
  canRegister?: boolean;
  onRegisterPayment?: (draft: CollectorPaymentDraft) => void;
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onLogout?: () => void;
};

type ListFilter = "pending" | "done";
type CardMode = "pay" | "skip" | null;

const SKIP_REASONS = [
  "No localizado",
  "Enfermo / no atiende",
  "Dirección incorrecta",
  "Otro",
];

function itemKey(item: DailyCollectionAssignment) {
  return `${item.itemId}-${item.dispatchDate}`;
}

export function CollectorMobileApp({
  collector,
  assignments,
  routes,
  loans,
  clients,
  date,
  preview = false,
  canRegister = true,
  onRegisterPayment,
  onSkipVisit,
  onLogout,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [cardMode, setCardMode] = useState<CardMode>(null);
  const [skipReason, setSkipReason] = useState(SKIP_REASONS[0]);
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const routeOptions = useMemo(
    () => collectorMobileRoutes(collector.ref, assignments, loans, clients, routes),
    [assignments, clients, collector.ref, loans, routes],
  );

  const activeDate = useMemo(() => {
    const fallback = date ?? todayIso();
    if (selectedDate && routeOptions.some((row) => row.date === selectedDate)) {
      return selectedDate;
    }
    return defaultMobileRouteDate(routeOptions, fallback);
  }, [date, routeOptions, selectedDate]);

  const activeRoute =
    routeOptions.find((row) => row.date === activeDate) ??
    routeOptions[0] ??
    null;

  const queue = useMemo(
    () => collectorMobileQueue(collector.ref, activeDate, assignments, loans, clients, routes),
    [activeDate, assignments, clients, collector.ref, loans, routes],
  );

  const routeRef = queue.routeRef ?? `RUT-D-${collector.ref}-${activeDate}`;
  const visibleItems = listFilter === "done" ? queue.done : queue.pending;

  const initials = collector.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  useEffect(() => {
    setExpandedKey(null);
    setCardMode(null);
  }, [activeDate, listFilter]);

  function openCard(item: DailyCollectionAssignment, mode: Exclude<CardMode, null>) {
    if (!canRegister || queue.closed) return;
    if (mode === "pay" && !onRegisterPayment) return;
    if (mode === "skip" && !onSkipVisit) return;
    const key = itemKey(item);
    if (expandedKey === key && cardMode === mode) {
      setExpandedKey(null);
      setCardMode(null);
      return;
    }
    setExpandedKey(key);
    setCardMode(mode);
    if (mode === "skip") setSkipReason(SKIP_REASONS[0]);
  }

  function closeCard() {
    setExpandedKey(null);
    setCardMode(null);
  }

  function selectFilter(next: ListFilter) {
    setListFilter(next);
    closeCard();
  }

  function confirmSkip(item: DailyCollectionAssignment) {
    if (!onSkipVisit) return;
    onSkipVisit({
      routeRef,
      clientRef: item.clientRef,
      loanRef: item.loanRef,
      dispatchDate: item.dispatchDate,
      collectorRef: collector.ref,
      reason: skipReason,
    });
    closeCard();
  }

  return (
    <div className={`collector-mobile-app${preview ? " is-preview" : ""}`}>
      {preview ? (
        <div className="collector-mobile-preview-banner">
          Vista previa · lo mismo que verá en el celular
        </div>
      ) : (
        <div className="collector-mobile-sync-banner">
          Cobros se envían a oficina · Sin contacto con otros cobradores
        </div>
      )}

      <header className="collector-mobile-header">
        <div className="collector-mobile-brand">
          <img src="/logo-ca-prestamo.png" alt="CA préstamo" className="brand-logo" />
          <div>
            <p className="collector-mobile-greet">Hola, {collector.name.split(" ")[0]}</p>
            <h1>Mis cobros</h1>
            <span className="collector-mobile-date">{queue.dateLabel}</span>
          </div>
        </div>
        <div className="collector-mobile-avatar">{initials}</div>
      </header>

      {routeOptions.length > 0 ? (
        <label className="collector-mobile-route-picker">
          <span>Ruta asignada</span>
          <select
            value={activeDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          >
            {routeOptions.map((row) => (
              <option key={row.date} value={row.date}>
                {row.routeName}
                {row.closed ? " · Cerrada" : ` · ${row.pending} pend.`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {queue.closed ? (
        <div className="collector-mobile-route-closed">
          <Pill label="Ruta cerrada" kind="paid" />
          <p>
            {queue.dispatched.every((row) => row.dayClosedAt)
              ? "Oficina cerró la jornada. Lo no cobrado queda para mañana (mora)."
              : `Completaste los cobros activos de esta ruta (${queue.dispatched.length}).`}
          </p>
        </div>
      ) : null}

      <div className="collector-mobile-stats">
        <button
          type="button"
          className={listFilter === "pending" ? "collector-mobile-stat on" : "collector-mobile-stat"}
          onClick={() => selectFilter("pending")}
        >
          <b>{queue.pending.length}</b>
          <span>Por cobrar</span>
        </button>
        <button
          type="button"
          className={listFilter === "done" ? "collector-mobile-stat on" : "collector-mobile-stat"}
          onClick={() => selectFilter("done")}
        >
          <b>{queue.done.length}</b>
          <span>Gestionados</span>
        </button>
        <div className="collector-mobile-stat readonly">
          <b>{money(queue.dispatched.reduce((sum, row) => sum + row.amountDue, 0))}</b>
          <span>Programado</span>
        </div>
      </div>

      {queue.awaitingDispatch.length > 0 && !queue.dispatched.length ? (
        <p className="collector-mobile-note warn">
          Tienes {queue.awaitingDispatch.length} cobro(s) asignados. Espera a que oficina envíe la ruta.
        </p>
      ) : null}

      {!queue.dispatched.length && !queue.awaitingDispatch.length ? (
        <section className="collector-mobile-empty">
          <h2>Sin rutas activas</h2>
          <p>Cuando te envíen cobros desde oficina, elige la ruta arriba y aparecerán aquí.</p>
        </section>
      ) : (
        <>
          <ul className={listFilter === "done" ? "collector-mobile-list compact" : "collector-mobile-list"}>
            {visibleItems.length === 0 ? (
              <li className="collector-mobile-empty-inline">
                {listFilter === "done"
                  ? "Aún no hay cobros gestionados en esta ruta."
                  : queue.closed
                    ? "Ruta cerrada. Elige otra ruta si tienes más asignadas."
                    : "¡Listo! No quedan cobros pendientes en esta ruta."}
              </li>
            ) : (
              visibleItems.map((item) => {
                const key = itemKey(item);
                const isOpen = expandedKey === key;
                const isDoneView = listFilter === "done";
                const canAct =
                  item.visitStatus !== "cobrado" &&
                  item.visitStatus !== "omitido" &&
                  !queue.closed;

                return (
                  <li
                    key={key}
                    className={
                      isDoneView
                        ? "collector-mobile-card is-done"
                        : isOpen
                          ? "collector-mobile-card is-open"
                          : "collector-mobile-card"
                    }
                  >
                    {isDoneView ? (
                      <div className="collector-mobile-done-row">
                        <strong>{item.clientName}</strong>
                        <span className="collector-mobile-amount">{money(item.amountDue)}</span>
                        <Pill
                          label={visitStatusLabel(item.visitStatus)}
                          kind={visitStatusKind(item.visitStatus)}
                        />
                        {item.skipReason ? (
                          <span className="collector-mobile-ref">{item.skipReason}</span>
                        ) : null}
                        {item.paymentRef ? (
                          <span className="collector-mobile-ref">{item.paymentRef}</span>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className="collector-mobile-card-main">
                          <strong>{item.clientName}</strong>
                          <span className="collector-mobile-amount">{money(item.amountDue)}</span>
                        </div>
                        {item.visitStatus === "parcial" || canAct ? (
                          <div className="collector-mobile-card-foot">
                            {item.visitStatus === "parcial" ? (
                              <Pill
                                label={visitStatusLabel(item.visitStatus)}
                                kind={visitStatusKind(item.visitStatus)}
                              />
                            ) : null}
                            {canAct ? (
                              <div className="collector-mobile-card-actions">
                                <button
                                  type="button"
                                  className={
                                    isOpen && cardMode === "pay"
                                      ? "btn compact collector-mobile-pay-btn"
                                      : "btn compact primary collector-mobile-pay-btn"
                                  }
                                  disabled={!canRegister || !onRegisterPayment}
                                  onClick={() => openCard(item, "pay")}
                                >
                                  {isOpen && cardMode === "pay" ? "Cerrar" : "Cobrar"}
                                </button>
                                <button
                                  type="button"
                                  className="btn compact ghost collector-mobile-skip-btn"
                                  disabled={!canRegister || !onSkipVisit}
                                  onClick={() => openCard(item, "skip")}
                                >
                                  {isOpen && cardMode === "skip" ? "Cerrar" : "No visitó"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {isOpen && cardMode === "pay" && onRegisterPayment ? (
                          <div className="collector-mobile-pay-inline">
                            <CollectorPayForm
                              variant="inline"
                              formId={key}
                              clientName={item.clientName}
                              amountDue={item.amountDue}
                              onCancel={closeCard}
                              onSubmit={(payload) => {
                                onRegisterPayment({
                                  idempotencyKey: payload.idempotencyKey,
                                  routeRef,
                                  clientRef: item.clientRef,
                                  loanRef: item.loanRef,
                                  amount: payload.amount,
                                  kind: payload.kind,
                                  method: payload.method,
                                  evidence: payload.evidence,
                                  collectorRef: collector.ref,
                                  collectorName: collector.name,
                                  clientName: item.clientName,
                                });
                                closeCard();
                              }}
                            />
                          </div>
                        ) : null}

                        {isOpen && cardMode === "skip" && onSkipVisit ? (
                          <div className="collector-mobile-skip-inline">
                            <label>
                              <span>Motivo</span>
                              <select
                                value={skipReason}
                                onChange={(event) => setSkipReason(event.target.value)}
                              >
                                {SKIP_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {reason}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="collector-mobile-skip-actions">
                              <button type="button" className="btn compact ghost" onClick={closeCard}>
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="btn compact secondary"
                                onClick={() => confirmSkip(item)}
                              >
                                Confirmar
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>

          {routeOptions.length > 1 && activeRoute?.closed ? (
            <p className="collector-mobile-next-route">
              Esta ruta ya está cerrada.{" "}
              {routeOptions.some((row) => !row.closed && row.date !== activeDate)
                ? "Elige otra ruta en el desplegable para seguir cobrando."
                : "No tienes más rutas pendientes."}
            </p>
          ) : null}
        </>
      )}

      {onLogout && !preview ? (
        <footer className="collector-mobile-foot">
          <button type="button" className="btn aside-logout" onClick={onLogout}>
            Cerrar sesión
          </button>
        </footer>
      ) : null}
    </div>
  );
}
