"use client";

import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import {
  dailyLogsForCollector,
  formatLogTime,
  paymentsForDailyLog,
  type CollectorDailyLogRow,
} from "@/lib/collector-daily-log";
import {
  buildCollectorDayHistory,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { periodFromDateIso } from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { money, type ActivityRow, type CollectorRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/payment-method";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";

type Props = {
  collectorRef: string;
  collector?: CollectorRow | null;
  dailyLogs: CollectorDailyLogRow[];
  payments: PaymentRow[];
  activities: ActivityRow[];
  routes: RouteRow[];
  dayCloses?: CollectorDayCloseRecord[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  monthCloses?: CollectorMonthCloseRecord[];
  assignments?: DailyCollectionAssignment[];
};

export function CollectorDailyHistory({
  collectorRef,
  collector,
  dailyLogs,
  payments,
  activities,
  routes,
  dayCloses = [],
  dayExpenseDrafts = [],
  monthCloses = [],
  assignments = [],
}: Props) {
  const [openRef, setOpenRef] = useState("");
  const rows = dailyLogsForCollector(collectorRef, dailyLogs, payments, activities, routes);

  const fallbackHistory = useMemo(() => {
    if (rows.length) return [];
    const period = periodFromDateIso(todayIso());
    return buildCollectorDayHistory(
      collectorRef,
      payments,
      dayCloses,
      collector ? [collector] : [],
      [],
      dayExpenseDrafts,
      monthCloses,
      period,
      { assignments, dailyLogs },
    ).filter((row) => row.cobro > 0 || row.gasto > 0);
  }, [
    assignments,
    collector,
    collectorRef,
    dailyLogs,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    payments,
    rows.length,
  ]);

  if (!rows.length && !fallbackHistory.length) {
    return <p className="ficha-empty">Aún no hay jornadas registradas para este cobrador.</p>;
  }

  if (!rows.length && fallbackHistory.length) {
    return (
      <div className="daily-archive">
        <p className="daily-archive-intro">
          Historial reconstruido desde cobros, cierres y planilla del mes en curso.
        </p>
        <table className="data mini-table daily-log-table">
          <thead>
            <tr>
              <th>Día</th>
              <th className="right">Cobro</th>
              <th className="right">Gasto</th>
              <th className="right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {fallbackHistory.map((row) => (
              <tr key={row.date}>
                <td>{row.dateLabel}</td>
                <td className="money right">{row.cobro > 0 ? money(row.cobro) : "—"}</td>
                <td className="money right">{row.gasto > 0 ? money(row.gasto) : "—"}</td>
                <td className="money right">{money(row.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="daily-archive">
      <p className="daily-archive-intro">
        Archivo de cobro diario. Cada renglón es una jornada; al registrar cobros en campo se va
        actualizando el seguimiento por fecha.
      </p>
      <table className="data mini-table daily-log-table">
        <colgroup>
          <col className="daily-col-date" />
          <col className="daily-col-route" />
          <col className="daily-col-visits" />
          <col className="daily-col-collected" />
          <col className="daily-col-status" />
          <col className="daily-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th className="daily-log-date">Fecha</th>
            <th className="daily-log-route">Ruta</th>
            <th className="daily-log-visits">Visitas</th>
            <th className="daily-log-collected">Cobrado</th>
            <th className="daily-log-status">Estado</th>
            <th className="daily-log-toggle">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = openRef === row.ref;
            const dayPayments = paymentsForDailyLog(collectorRef, row.date, payments);
            return (
              <DailyLogEntry
                key={row.ref}
                row={row}
                open={open}
                dayPayments={dayPayments}
                onToggle={() => setOpenRef(open ? "" : row.ref)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyLogEntry({
  row,
  open,
  dayPayments,
  onToggle,
}: {
  row: CollectorDailyLogRow;
  open: boolean;
  dayPayments: PaymentRow[];
  onToggle: () => void;
}) {
  const visitLabel = `${row.visitsDone}/${row.visitsPlanned}`;
  const kind =
    row.status === "Cerrada" ? "paid" : row.status === "En curso" ? "pending" : "draft";

  return (
    <>
      <tr className={open ? "daily-log-row open" : "daily-log-row"}>
        <td className="daily-log-date">{row.dateLabel}</td>
        <td className="daily-log-route">
          {row.routeName ? (
            <>
              {row.routeName}
              {row.zone ? <span className="daily-log-zone"> · {row.zone}</span> : null}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="daily-log-visits">{visitLabel}</td>
        <td className="daily-log-collected money">{row.collected > 0 ? money(row.collected) : "—"}</td>
        <td className="daily-log-status">
          <Pill label={row.status} kind={kind} />
        </td>
        <td className="daily-log-toggle">
          <button type="button" className="btn-link" onClick={onToggle}>
            {open ? "Cerrar" : "Ver día"}
          </button>
        </td>
      </tr>
      {open ? (
        <>
          <tr className="daily-log-detail-row daily-log-detail-summary">
            <td colSpan={6}>
              <div className="daily-log-detail-panel">
                <p className="daily-log-summary">{row.summary}</p>
                <div className="daily-log-detail-meta">
                  <span>
                    <b>Visitas</b> {visitLabel}
                  </span>
                  <span>
                    <b>Cobrado</b> {row.collected > 0 ? money(row.collected) : "—"}
                  </span>
                  <span>
                    <b>Inicio</b> {formatLogTime(row.startedAt)}
                  </span>
                  <span>
                    <b>Cierre</b> {formatLogTime(row.closedAt)}
                  </span>
                  <span>
                    <b>Cobros</b> {row.paymentsCount}
                  </span>
                </div>
              </div>
            </td>
          </tr>
          {dayPayments.length ? (
            <tr className="daily-log-detail-row daily-log-detail-payments">
              <td className="daily-log-date" />
              <td colSpan={5}>
                <table className="data mini-table daily-log-payments-table">
                  <colgroup>
                    <col className="pay-col-time" />
                    <col className="pay-col-client" />
                    <col className="pay-col-value" />
                    <col className="pay-col-type" />
                    <col className="pay-col-method" />
                    <col className="pay-col-evidence" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="pay-col-time">Hora</th>
                      <th className="pay-col-client">Cliente</th>
                      <th className="pay-col-value">Valor</th>
                      <th className="pay-col-type">Tipo</th>
                      <th className="pay-col-method">Forma de pago</th>
                      <th className="pay-col-evidence">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayPayments.map((payment) => (
                      <tr key={payment.ref}>
                        <td className="pay-col-time">
                          {payment.when.split("·").pop()?.trim() ?? payment.when}
                        </td>
                        <td className="pay-col-client">{payment.client}</td>
                        <td className="pay-col-value money">{money(payment.amount)}</td>
                        <td className="pay-col-type">{payment.type}</td>
                        <td className="pay-col-method">{paymentMethodLabel(normalizePaymentMethod(payment.method))}</td>
                        <td className="pay-col-evidence pay-evidence-cell">
                          <PaymentEvidenceThumb evidence={payment.evidence} size={22} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          ) : (
            <tr className="daily-log-detail-row">
              <td className="daily-log-date" />
              <td colSpan={5}>
                <p className="daily-log-empty">Sin cobros registrados ese día.</p>
              </td>
            </tr>
          )}
        </>
      ) : null}
    </>
  );
}
