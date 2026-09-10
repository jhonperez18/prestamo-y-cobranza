"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { Kpi, Pill } from "@/components/ui";
import type { ModuleId } from "@/lib/navigation";
import {
  buildDailyCollectionList,
  dailyCollectionSummary,
  findAssignment,
  formatChargeDate,
  type DailyCollectionAssignment,
} from "@/lib/daily-collection-plan";
import { dayCloseSummary } from "@/lib/collector-dispatch-sync";
import { syncLoan } from "@/lib/loan-preview";
import {
  dispatchDateHint,
  isoToDispatchLabel,
  todayIso,
} from "@/lib/daily-dispatch";
import {
  money,
  catalogRoutes,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { DAILY_COLLECTION_COLUMNS, DAILY_COLLECTION_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  onGenerate: (date: string) => void;
  onDispatch: (date: string) => void;
  onCloseDay: (date: string) => void;
  onAssignItem: (itemId: string, loanRef: string, collectorRef: string, date: string) => void;
  onOpenClient?: (clientRef: string) => void;
  onOpenLoan?: (loanRef: string) => void;
  onOpenMobile?: (collectorRef?: string) => void;
  onToast?: (message: string) => void;
  onGo?: (moduleId: ModuleId, viewId?: string) => void;
};

type ListFilter = "all" | "pending" | "mora" | "assigned";

function isStillDue(
  itemId: string,
  assignments: DailyCollectionAssignment[],
  selectedDate: string,
) {
  const assigned = findAssignment(assignments, itemId, selectedDate);
  if (!assigned?.dispatched) return true;
  return assigned.visitStatus !== "cobrado";
}

const DISPATCH_DATE_KEY = "nexo-dispatch-date";

function readStoredDate() {
  const today = todayIso();
  if (typeof window === "undefined") return today;
  const stored = window.localStorage.getItem(DISPATCH_DATE_KEY);
  if (stored && stored >= today) return stored;
  return today;
}

function itemStatusKind(kind: "cuota" | "alerta" | "mora") {
  if (kind === "mora") return "overdue";
  if (kind === "alerta") return "warn";
  return "pending";
}

function itemStatusLabel(kind: "cuota" | "alerta" | "mora", alertCount?: number) {
  if (kind === "mora") return "Mora";
  if (kind === "alerta") {
    const n = Number(alertCount) || 0;
    return n > 0 ? `Alerta ${n}` : "Alerta";
  }
  return "Pendiente";
}

export function DailyCollectionsView({
  loans,
  payments,
  clients,
  collectors,
  routes,
  assignments,
  onGenerate,
  onDispatch,
  onCloseDay,
  onAssignItem: _onAssignItem,
  onOpenClient,
  onOpenLoan,
  onOpenMobile,
  onToast,
  onGo,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [routeFilter, setRouteFilter] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [draftCollectors, setDraftCollectors] = useState<Record<string, string>>({});
  const [listReady, setListReady] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const lastSyncedDate = useRef<string | null>(null);

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
    () => buildDailyCollectionList(syncedLoans, clients, selectedDate, payments),
    [syncedLoans, clients, selectedDate, payments],
  );

  const catalog = useMemo(() => catalogRoutes(routes), [routes]);

  /** Todas las rutas del catálogo (aunque hoy no tengan cobros). */
  const routeOptions = useMemo(
    () =>
      catalog
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((row) => row.name),
    [catalog],
  );

  useEffect(() => {
    setSelectedDate(readStoredDate());
  }, []);

  useEffect(() => {
    setListFilter("all");
  }, [selectedDate, routeFilter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DISPATCH_DATE_KEY, selectedDate);
  }, [selectedDate]);

  function collectorRefForRoute(routeName: string) {
    return catalog.find((row) => row.name === routeName)?.collectorRef ?? "";
  }

  function collectorNameForRef(ref: string) {
    return collectors.find((row) => row.ref === ref)?.name ?? "";
  }

  useEffect(() => {
    setDraftCollectors((current) => {
      const next = { ...current };
      for (const item of allItems) {
        if (next[item.id] !== undefined) continue;
        const assigned = findAssignment(assignments, item.id, selectedDate);
        next[item.id] =
          assigned?.collectorRef ||
          collectorRefForRoute(item.clientRoute) ||
          activeCollectors[0]?.ref ||
          "";
      }
      return next;
    });
  }, [allItems, assignments, selectedDate, activeCollectors, catalog]);

  // Al entrar / cambiar fecha: sincroniza planilla desde rutas fijas (sin toast).
  useEffect(() => {
    if (lastSyncedDate.current === selectedDate) return;
    lastSyncedDate.current = selectedDate;
    setListReady(true);
    onGenerate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar fecha
  }, [selectedDate]);

  const activeItems = useMemo(() => {
    if (!listReady) return [];
    return allItems.filter((item) => {
      if (routeFilter && item.clientRoute !== routeFilter) return false;
      if (listFilter === "pending") return isStillDue(item.id, assignments, selectedDate);
      if (listFilter === "mora") return item.kind === "mora";
      if (listFilter === "assigned") {
        const assigned = findAssignment(assignments, item.id, selectedDate);
        return Boolean(assigned?.dispatched);
      }
      return true;
    });
  }, [allItems, routeFilter, listReady, listFilter, assignments, selectedDate]);

  const summary = useMemo(() => dailyCollectionSummary(activeItems), [activeItems]);

  const inAppToday = useMemo(
    () =>
      assignments.filter(
        (row) =>
          row.dispatchDate === selectedDate &&
          row.dispatched &&
          activeItems.some((item) => item.id === row.itemId),
      ).length,
    [assignments, selectedDate, activeItems],
  );

  const missingRouteCollector = useMemo(
    () =>
      activeItems.filter((item) => {
        const assigned = findAssignment(assignments, item.id, selectedDate);
        if (assigned?.dispatched) return false;
        return !collectorRefForRoute(item.clientRoute);
      }).length,
    [activeItems, assignments, selectedDate, catalog],
  );

  const closeSummary = useMemo(
    () => dayCloseSummary(assignments, selectedDate),
    [assignments, selectedDate],
  );

  const firstDispatchedCollector = useMemo(() => {
    const row = assignments.find((entry) => entry.dispatchDate === selectedDate && entry.dispatched);
    return row?.collectorRef;
  }, [assignments, selectedDate]);

  function focusList(filter: ListFilter) {
    setListFilter(filter);
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function generateList() {
    setListReady(true);
    onDispatch(selectedDate);
  }

  function assignItem(itemId: string, loanRef: string) {
    const existing = findAssignment(assignments, itemId, selectedDate);
    if (existing) {
      onToast?.("Este cobro ya está en la planilla del día.");
      return;
    }
    if (!canAssign) {
      onToast?.("Solo puedes asignar cobros desde hoy en adelante.");
      return;
    }
    onToast?.(
      "El cobrador se define por ruta (fijo). Ve a Inicio → Asignar cobrador; al guardar, la planilla se actualiza sola.",
    );
    onGo?.("inicio", "asignar-clientes");
  }

  function confirmCloseDay() {
    if (!closeSummary.canClose) {
      onToast?.(
        closeSummary.alreadyClosed
          ? "La jornada de este día ya está cerrada."
          : "No hay planilla en app para cerrar. Asigna cobrador en rutas y pulsa Actualizar planillas.",
      );
      return;
    }
    const detail =
      closeSummary.pending > 0
        ? `${closeSummary.pending} visita(s) pendiente(s) sumarán alerta (mora al 4.º día hábil sin pago).`
        : "Se cerrará la jornada con los cobros ya registrados.";
    if (
      typeof window !== "undefined" &&
      !window.confirm(`¿Cerrar el día ${dateLabel}?\n\n${detail}`)
    ) {
      return;
    }
    onCloseDay(selectedDate);
  }

  return (
    <section className="panel daily-collections">
      <div className="head">
        <div className="head-title">
          <h1>Cobros del día</h1>
          <span className="count">{activeItems.length}</span>
        </div>
        <div className="grow" />
        <button type="button" className="btn primary" disabled={!canAssign} onClick={generateList}>
          Actualizar planillas
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!closeSummary.canClose}
          onClick={confirmCloseDay}
          title={
            closeSummary.alreadyClosed
              ? "Jornada ya cerrada"
              : "Cierra la jornada: pendientes → no visitados"
          }
        >
          {closeSummary.alreadyClosed ? "Día cerrado" : "Cerrar día"}
        </button>
        {onOpenMobile ? (
          <button
            type="button"
            className="btn ghost"
            disabled={!firstDispatchedCollector}
            onClick={() => onOpenMobile(firstDispatchedCollector)}
            title="Ver la misma pantalla del cobrador"
          >
            Ver en móvil
          </button>
        ) : null}
      </div>
      <p className="panel-lead">
        El cobrador sale de la ruta y <strong>queda fijo</strong> día a día. Cámbialo solo en{" "}
        <button type="button" className="btn-link" onClick={() => onGo?.("inicio", "asignar-clientes")}>
          Asignar cobrador
        </button>
        ; la planilla de hoy (y futuros) se arma sola para la app.
      </p>

      <div className="kpis tone-kpis">
        <Kpi
          label="Cobros"
          value={String(summary.total)}
          hint={`${summary.cuotas} cuotas · ${summary.alertas} alertas · ${summary.mora} mora`}
          tone="teal"
          onClick={() => focusList("all")}
        />
        <Kpi
          label="Por cobrar"
          value={money(summary.totalDue)}
          hint={`${money(summary.cuotaDue)} cuotas`}
          tone="amber"
          onClick={() => focusList("pending")}
        />
        <Kpi
          label="Mora"
          value={money(summary.moraDue)}
          hint={`${summary.mora} clientes`}
          tone="coral"
          onClick={() => onGo?.("cartera", "mora")}
        />
        <Kpi
          label="En app"
          value={String(inAppToday)}
          hint={
            missingRouteCollector
              ? `${missingRouteCollector} sin cobrador de ruta`
              : "Planilla enviada al cobrador"
          }
          tone="sage"
          onClick={() => focusList("assigned")}
        />
      </div>

      {closeSummary.total > 0 ? (
        <div className="daily-close-banner">
          <div>
            <strong>
              {closeSummary.alreadyClosed ? "Jornada cerrada" : "Jornada en curso"}
            </strong>
            <p>
              {closeSummary.collected} cobrado{closeSummary.collected === 1 ? "" : "s"}
              {" · "}
              {closeSummary.partial} parcial{closeSummary.partial === 1 ? "" : "es"}
              {" · "}
              {closeSummary.pending} pendiente{closeSummary.pending === 1 ? "" : "s"}
              {" · "}
              {closeSummary.skipped} no visitado{closeSummary.skipped === 1 ? "" : "s"}
              {" · "}
              {closeSummary.collectors} cobrador{closeSummary.collectors === 1 ? "" : "es"}
            </p>
          </div>
          {closeSummary.alreadyClosed ? (
            <Pill label="Cerrada" kind="paid" />
          ) : closeSummary.pending > 0 ? (
            <Pill label={`${closeSummary.pending} sin visitar`} kind="overdue" />
          ) : (
            <Pill label="Lista para cerrar" kind="ok" />
          )}
        </div>
      ) : null}

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
          <span>Ruta</span>
          <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}>
            <option value="">Todas las rutas</option>
            {routeOptions.map((row) => (
              <option key={row} value={row}>
                Ruta {row}
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

      <div className="table-wrap daily-collection-table" ref={tableRef}>
        <table className="data list-grid daily-collection-grid">
          <colgroup>
            {isVisible("index") ? <col className="dc-index" /> : null}
            {isVisible("client") ? <col className="dc-client" /> : null}
            {isVisible("zone") ? <col className="dc-zone" /> : null}
            {isVisible("loan") ? <col className="dc-loan" /> : null}
            {isVisible("concept") ? <col className="dc-concept" /> : null}
            {isVisible("since") ? <col className="dc-since" /> : null}
            {isVisible("amount") ? <col className="dc-amount" /> : null}
            {isVisible("status") ? <col className="dc-status" /> : null}
            {isVisible("collector") ? <col className="dc-collector" /> : null}
            {isVisible("action") ? <col className="dc-action" /> : null}
            <col className="dc-picker" />
          </colgroup>
          <thead>
            <tr className="col-titles">
              {isVisible("index") ? <th>#</th> : null}
              {isVisible("client") ? <th>Cliente</th> : null}
              {isVisible("zone") ? <th>Ruta</th> : null}
              {isVisible("loan") ? <th>Préstamo</th> : null}
              {isVisible("concept") ? <th>Concepto</th> : null}
              {isVisible("since") ? <th>Desde</th> : null}
              {isVisible("amount") ? <th className="right">A cobrar</th> : null}
              {isVisible("status") ? <th>Estado</th> : null}
              {isVisible("collector") ? <th>Cobrador</th> : null}
              {isVisible("action") ? <th>Acción</th> : null}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={DAILY_COLLECTION_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {activeItems.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>
                  {listFilter === "pending"
                    ? "No hay cobros pendientes por recaudar en esta fecha."
                    : listFilter === "mora"
                      ? "No hay clientes con mora en esta fecha."
                      : listFilter === "assigned"
                        ? "No hay planilla en app para esta fecha. Asigna cobrador en rutas o pulsa Actualizar planillas."
                        : "No hay cobros pendientes para esta fecha."}
                </td>
              </tr>
            ) : (
              activeItems.map((item, index) => {
                const assigned = findAssignment(assignments, item.id, selectedDate);
                const routeCollectorRef = collectorRefForRoute(item.clientRoute);
                const draftRef =
                  draftCollectors[item.id] ||
                  assigned?.collectorRef ||
                  routeCollectorRef ||
                  "";
                const inApp = Boolean(assigned?.dispatched);
                const locked = inApp || Boolean(routeCollectorRef);
                const displayCollector =
                  assigned?.collector ||
                  collectorNameForRef(draftRef) ||
                  "—";

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
                    {isVisible("concept") ? (
                      <td className="daily-col-concept" title={item.chargeLabel}>
                        {item.chargeLabel}
                      </td>
                    ) : null}
                    {isVisible("since") ? <td>{formatChargeDate(item.chargeDate)}</td> : null}
                    {isVisible("amount") ? (
                      <td
                        className="money right"
                        title={
                          item.moraAmount > 0 && item.cuotaAmount > 0
                            ? `Cuota ${money(item.cuotaAmount)} + mora ${money(item.moraAmount)}`
                            : undefined
                        }
                      >
                        {money(item.amountDue)}
                      </td>
                    ) : null}
                    {isVisible("status") ? (
                      <td>
                        {assigned?.dispatched ? (
                          <Pill
                            label={
                              assigned.visitStatus === "cobrado"
                                ? "pago"
                                : assigned.visitStatus === "parcial"
                                  ? "Parc."
                                  : assigned.visitStatus === "omitido"
                                    ? "S/C"
                                    : "Pend."
                            }
                            kind={
                              assigned.visitStatus === "cobrado"
                                ? "ok"
                                : assigned.visitStatus === "parcial"
                                  ? "partial"
                                  : assigned.visitStatus === "omitido"
                                    ? "overdue"
                                    : "pending"
                            }
                          />
                        ) : (
                          <Pill
                            label={itemStatusLabel(item.kind, item.alertCount)}
                            kind={itemStatusKind(item.kind)}
                          />
                        )}
                      </td>
                    ) : null}
                    {isVisible("collector") ? (
                      <td>
                        {locked ? (
                          <span className="daily-collector-fixed" title="Cobrador de la ruta (fijo)">
                            {displayCollector}
                          </span>
                        ) : (
                          <select
                            className="daily-row-collector"
                            value={draftRef}
                            disabled={!canAssign}
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
                        )}
                      </td>
                    ) : null}
                    {isVisible("action") ? (
                      <td className="daily-row-action">
                        {inApp ? (
                          <span className="daily-assign-ok">En app</span>
                        ) : routeCollectorRef ? (
                          <button
                            type="button"
                            className="btn ghost compact"
                            disabled={!canAssign}
                            onClick={generateList}
                            title="Sincroniza la planilla con las rutas"
                          >
                            Sync
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn primary compact"
                            onClick={() => assignItem(item.id, item.loanRef)}
                          >
                            En rutas
                          </button>
                        )}
                      </td>
                    ) : null}
                    <ColumnPickerBodyCell />
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
