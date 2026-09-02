"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { Kpi, Pill } from "@/components/ui";
import {
  buildDailyCollectionList,
  dailyCollectionSummary,
  findAssignment,
  formatChargeDate,
  type DailyCollectionAssignment,
} from "@/lib/daily-collection-plan";
import { syncLoan } from "@/lib/loan-preview";
import {
  dispatchDateHint,
  isoToDispatchLabel,
  todayIso,
} from "@/lib/daily-dispatch";
import {
  money,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import { DAILY_COLLECTION_COLUMNS, DAILY_COLLECTION_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  onGenerate: (date: string) => void;
  onDispatch: (date: string) => void;
  onAssignItem: (itemId: string, loanRef: string, collectorRef: string, date: string) => void;
  onOpenClient?: (clientRef: string) => void;
  onOpenLoan?: (loanRef: string) => void;
  onToast?: (message: string) => void;
};

const DISPATCH_DATE_KEY = "nexo-dispatch-date";

function readStoredDate() {
  const today = todayIso();
  if (typeof window === "undefined") return today;
  const stored = window.localStorage.getItem(DISPATCH_DATE_KEY);
  if (stored && stored >= today) return stored;
  return today;
}

function itemStatusKind(kind: "cuota" | "mora") {
  return kind === "mora" ? "overdue" : "pending";
}

function itemStatusLabel(kind: "cuota" | "mora") {
  return kind === "mora" ? "Mora" : "Pendiente";
}

export function DailyCollectionsView({
  loans,
  payments,
  clients,
  collectors,
  assignments,
  onGenerate,
  onDispatch,
  onAssignItem,
  onOpenClient,
  onOpenLoan,
  onToast,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [routeFilter, setRouteFilter] = useState("");
  const [draftCollectors, setDraftCollectors] = useState<Record<string, string>>({});
  const [listReady, setListReady] = useState(true);

  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    DAILY_COLLECTION_COLUMNS,
    DAILY_COLLECTION_DEFAULT_COLS,
    { storageKey: "nexo.cobranza.cobros-dia.columns" },
  );

  const today = todayIso();
  const dateLabel = isoToDispatchLabel(selectedDate);
  const dateHint = dispatchDateHint(selectedDate, today);
  const canAssign = selectedDate >= today;

  const activeCollectors = useMemo(
    () => collectors.filter((row) => row.active && row.mobileAccess),
    [collectors],
  );

  const syncedLoans = useMemo(
    () => loans.map((loan) => syncLoan(loan, payments) as LoanRow),
    [loans, payments],
  );

  const allItems = useMemo(
    () => buildDailyCollectionList(syncedLoans, clients, selectedDate),
    [syncedLoans, clients, selectedDate],
  );

  const routeOptions = useMemo(() => {
    const zones = new Set(allItems.map((row) => row.clientRoute).filter((row) => row && row !== "—"));
    return [...zones].sort();
  }, [allItems]);

  useEffect(() => {
    setSelectedDate(readStoredDate());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DISPATCH_DATE_KEY, selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    setDraftCollectors((current) => {
      const next = { ...current };
      for (const item of allItems) {
        if (next[item.id] !== undefined) continue;
        const assigned = findAssignment(assignments, item.id, selectedDate);
        next[item.id] = assigned?.collectorRef ?? activeCollectors[0]?.ref ?? "";
      }
      return next;
    });
  }, [allItems, assignments, selectedDate, activeCollectors]);

  const activeItems = useMemo(() => {
    if (!listReady) return [];
    return allItems.filter((item) => {
      if (routeFilter && item.clientRoute !== routeFilter) return false;
      return true;
    });
  }, [allItems, routeFilter, listReady]);

  const summary = useMemo(() => dailyCollectionSummary(activeItems), [activeItems]);

  const assignedToday = useMemo(
    () =>
      assignments.filter(
        (row) =>
          row.dispatchDate === selectedDate &&
          !row.dispatched &&
          activeItems.some((item) => item.id === row.itemId),
      ).length,
    [assignments, selectedDate, activeItems],
  );

  function generateList() {
    setListReady(true);
    onGenerate(selectedDate);
  }

  function assignItem(itemId: string, loanRef: string) {
    const existing = findAssignment(assignments, itemId, selectedDate);
    if (existing) {
      onToast?.("Este cobro ya está asignado para este día.");
      return;
    }
    if (!canAssign) {
      onToast?.("Solo puedes asignar cobros desde hoy en adelante.");
      return;
    }
    const collectorRef = draftCollectors[itemId];
    if (!collectorRef) {
      onToast?.("Elige un cobrador antes de asignar.");
      return;
    }
    onAssignItem(itemId, loanRef, collectorRef, selectedDate);
  }

  return (
    <section className="panel daily-collections">
      <div className="head">
        <div className="head-title">
          <h1>Cobros del día</h1>
          <span className="count">{activeItems.length}</span>
        </div>
        <div className="grow" />
        <button type="button" className="btn ghost" onClick={generateList}>
          Generar lista
        </button>
        <button type="button" className="btn primary" disabled={!canAssign} onClick={() => onDispatch(selectedDate)}>
          Enviar a cobradores
        </button>
        <ColumnPicker
          columns={DAILY_COLLECTION_COLUMNS}
          visibleCols={visibleCols}
          onToggle={toggleColumn}
        />
      </div>

      <div className="kpis tone-kpis">
        <Kpi
          label="Cobros"
          value={String(summary.total)}
          hint={`${summary.cuotas} cuotas · ${summary.mora} mora`}
          tone="teal"
        />
        <Kpi
          label="Por cobrar"
          value={money(summary.totalDue)}
          hint={`${money(summary.cuotaDue)} cuotas`}
          tone="amber"
        />
        <Kpi label="Mora" value={money(summary.moraDue)} hint={`${summary.mora} clientes`} tone="coral" />
        <Kpi label="Asignados" value={String(assignedToday)} hint="Listos para enviar" tone="sage" />
      </div>

      <div className="daily-date-bar">
        <label className="daily-date-field">
          <span>Fecha de cobro</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
        <label className="daily-date-field">
          <span>Zona</span>
          <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}>
            <option value="">Todas las zonas</option>
            {routeOptions.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
        </label>
        <div className="daily-date-meta">
          <strong>{dateLabel}</strong>
          <Pill
            label={dateHint}
            kind={dateHint === "Programado" ? "draft" : dateHint === "Hoy" ? "ok" : "paid"}
          />
        </div>
      </div>

      <div className="table-wrap daily-collection-table">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              {isVisible("index") ? <th>#</th> : null}
              {isVisible("client") ? <th>Cliente</th> : null}
              {isVisible("zone") ? <th>Zona</th> : null}
              {isVisible("loan") ? <th>Préstamo</th> : null}
              {isVisible("concept") ? <th>Concepto</th> : null}
              {isVisible("since") ? <th>Desde</th> : null}
              {isVisible("amount") ? <th className="right">A cobrar</th> : null}
              {isVisible("status") ? <th>Estado</th> : null}
              {isVisible("collector") ? <th>Cobrador</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {activeItems.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>
                  {listReady
                    ? "No hay cobros pendientes para esta fecha."
                    : "Pulsa Generar lista para cargar los cobros del día."}
                </td>
              </tr>
            ) : (
              activeItems.map((item, index) => {
                const assigned = findAssignment(assignments, item.id, selectedDate);
                const draftRef = draftCollectors[item.id] ?? assigned?.collectorRef ?? "";
                const locked = Boolean(assigned);

                return (
                  <tr key={item.id}>
                    {isVisible("index") ? <td>{index + 1}</td> : null}
                    {isVisible("client") ? (
                      <td>
                        {onOpenClient ? (
                          <button
                            type="button"
                            className="btn-link daily-client-link"
                            title="Ver ficha del cliente"
                            onClick={() => onOpenClient(item.clientRef)}
                          >
                            {item.clientName}
                          </button>
                        ) : (
                          <strong>{item.clientName}</strong>
                        )}
                      </td>
                    ) : null}
                    {isVisible("zone") ? <td>{item.clientRoute}</td> : null}
                    {isVisible("loan") ? (
                      <td>
                        {onOpenLoan ? (
                          <button
                            type="button"
                            className="btn-link ref"
                            title="Ver préstamo"
                            onClick={() => onOpenLoan(item.loanRef)}
                          >
                            {item.loanRef}
                          </button>
                        ) : (
                          <span className="ref">{item.loanRef}</span>
                        )}
                      </td>
                    ) : null}
                    {isVisible("concept") ? <td>{item.chargeLabel}</td> : null}
                    {isVisible("since") ? (
                      <td>
                        {formatChargeDate(item.chargeDate)}
                        {item.moraAmount > 0 && item.cuotaAmount > 0 ? (
                          <em className="route-due-tag block">
                            Cuota {money(item.cuotaAmount)} + mora {money(item.moraAmount)}
                          </em>
                        ) : item.moraAmount > 0 ? (
                          <em className="route-due-tag block">Mora acumulada</em>
                        ) : null}
                      </td>
                    ) : null}
                    {isVisible("amount") ? <td className="money right">{money(item.amountDue)}</td> : null}
                    {isVisible("status") ? (
                      <td>
                        <Pill
                          label={itemStatusLabel(item.kind)}
                          kind={itemStatusKind(item.kind)}
                        />
                      </td>
                    ) : null}
                    {isVisible("collector") ? (
                      <td>
                        <select
                          className="daily-row-collector"
                          value={draftRef}
                          disabled={locked || !canAssign}
                          onChange={(event) =>
                            setDraftCollectors((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Elegir…</option>
                          {activeCollectors.map((row) => (
                            <option key={row.ref} value={row.ref}>
                              {row.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td className="daily-row-action">
                      {locked ? (
                        <span className="daily-assign-ok">Asignado a {assigned?.collector}</span>
                      ) : (
                        <button
                          type="button"
                          className="btn primary compact"
                          disabled={!draftRef || !canAssign}
                          onClick={() => assignItem(item.id, item.loanRef)}
                        >
                          Asignar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
