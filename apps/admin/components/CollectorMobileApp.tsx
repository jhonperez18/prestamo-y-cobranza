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
  onLogout?: () => void;
};

type ListFilter = "pending" | "done";

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
  onLogout,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
  }, [activeDate, listFilter]);

  function togglePay(item: DailyCollectionAssignment) {
    if (!canRegister || !onRegisterPayment || queue.closed) return;
    const key = itemKey(item);
    setExpandedKey((current) => (current === key ? null : key));
  }

  function closePay() {
    setExpandedKey(null);
  }

  function selectFilter(next: ListFilter) {
    setListFilter(next);
    setExpandedKey(null);
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
          <p>Completaste los {queue.dispatched.length} cobros de esta ruta.</p>
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
          <span>Cobrados</span>
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
                  ? "Aún no hay cobros en esta ruta."
                  : queue.closed
                    ? "Ruta cerrada. Elige otra ruta si tienes más asignadas."
                    : "¡Listo! No quedan cobros pendientes en esta ruta."}
              </li>
            ) : (
              visibleItems.map((item) => {
                const key = itemKey(item);
                const isOpen = expandedKey === key;
                const isDoneView = listFilter === "done";

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
                        <div className="collector-mobile-card-foot">
                          <Pill
                            label={visitStatusLabel(item.visitStatus)}
                            kind={visitStatusKind(item.visitStatus)}
                          />
                          {item.visitStatus !== "cobrado" && !queue.closed ? (
                            <button
                              type="button"
                              className={
                                isOpen
                                  ? "btn collector-mobile-pay-btn"
                                  : "btn primary collector-mobile-pay-btn"
                              }
                              disabled={!canRegister || !onRegisterPayment}
                              onClick={() => togglePay(item)}
                            >
                              {isOpen ? "Cerrar" : "Cobrar"}
                            </button>
                          ) : null}
                        </div>

                        {isOpen && onRegisterPayment ? (
                          <div className="collector-mobile-pay-inline">
                            <CollectorPayForm
                              variant="inline"
                              formId={key}
                              clientName={item.clientName}
                              amountDue={item.amountDue}
                              onCancel={closePay}
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
                                setExpandedKey(null);
                              }}
                            />
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
