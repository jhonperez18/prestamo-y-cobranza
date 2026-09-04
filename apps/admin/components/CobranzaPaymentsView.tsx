"use client";

import { useCallback, useMemo, useState } from "react";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { PaymentRefLink } from "@/components/PaymentRefLink";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import { ReportPdfPreview } from "@/components/ReportPdfPreview";
import { Kpi, Pill } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  buildCobranzaPaymentsReport,
  cobranzaPaymentsReportFileName,
  defaultCobranzaReportRange,
  type CobranzaPaymentsReportKind,
} from "@/lib/cobranza-payments-report";
import {
  cobranzaPaymentsReportPdfBlobAsync,
  downloadCobranzaPaymentsReportPdfAsync,
} from "@/lib/cobranza-payments-report-pdf";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import {
  normalizePaymentMethod,
  paymentMethodKind,
  paymentMethodLabel,
} from "@/lib/payment-method";
import {
  filterPaymentsByRecaudoRange,
  loansByRef,
  sortPayments,
  type PaymentSortKey,
  type SortDir,
} from "@/lib/payment-detail";
import {
  COBRANZA_PAYMENT_COLUMNS,
  COBRANZA_PAYMENT_DEFAULT_COLS,
} from "@/lib/table-columns";

type Props = {
  kind: CobranzaPaymentsReportKind;
  payments: PaymentRow[];
  loans: LoanRow[];
  collectors: string[];
  assignments?: DailyCollectionAssignment[];
  initialRange?: { fromIso: string; toIso: string };
  onOpenPayment: (ref: string) => void;
};

const SORT_HEADERS = [
  { id: "ref", t: "Ref", sortKey: "ref" },
  { id: "fecha", t: "Fecha", sortKey: "fecha" },
  { id: "cliente", t: "Cliente", sortKey: "cliente" },
  { id: "cobrador", t: "Cobrador", sortKey: "cobrador" },
  { id: "valor", t: "Valor", right: true, sortKey: "valor" },
  { id: "method", t: "Forma de pago" },
  { id: "evidence", t: "Comprobante" },
  { id: "tipo", t: "Tipo", sortKey: "tipo" },
  { id: "estado", t: "Estado" },
] as const;

export function CobranzaPaymentsView({
  kind,
  payments,
  loans,
  collectors,
  assignments = [],
  initialRange,
  onOpenPayment,
}: Props) {
  const defaults = initialRange ?? defaultCobranzaReportRange();
  const [fromIso, setFromIso] = useState(defaults.fromIso);
  const [toIso, setToIso] = useState(defaults.toIso);
  const [collectorFilter, setCollectorFilter] = useState("");
  const [paymentSortKey, setPaymentSortKey] = useState<PaymentSortKey>("fecha");
  const [paymentSortDir, setPaymentSortDir] = useState<SortDir>("desc");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const columnVisibility = useColumnVisibility(
    COBRANZA_PAYMENT_COLUMNS,
    COBRANZA_PAYMENT_DEFAULT_COLS,
    { storageKey: "nexo.cobranza.pagos.columns" },
  );

  const title = kind === "abonos" ? "Abonos" : "Pagos";
  const source =
    kind === "abonos" ? payments.filter((row) => row.type === "Abono") : payments;

  const filtered = useMemo(() => {
    const ranged = filterPaymentsByRecaudoRange(source, fromIso, toIso);
    if (!collectorFilter) return ranged;
    return ranged.filter((row) => row.collector === collectorFilter);
  }, [source, fromIso, toIso, collectorFilter]);

  const sorted = useMemo(
    () => sortPayments(filtered, paymentSortKey, paymentSortDir),
    [filtered, paymentSortKey, paymentSortDir],
  );

  const loanMap = useMemo(() => loansByRef(loans), [loans]);
  const total = useMemo(() => filtered.reduce((sum, row) => sum + row.amount, 0), [filtered]);

  const report = useMemo(
    () =>
      buildCobranzaPaymentsReport({
        kind,
        payments,
        loans,
        assignments,
        fromIso,
        toIso,
        collectorFilter: collectorFilter || undefined,
      }),
    [kind, payments, loans, assignments, fromIso, toIso, collectorFilter],
  );

  const buildPdfBlob = useCallback(
    () =>
      cobranzaPaymentsReportPdfBlobAsync(report, {
        visibleCols: columnVisibility.visibleCols,
      }),
    [report, columnVisibility.visibleCols],
  );

  const downloadPdf = useCallback(
    () =>
      downloadCobranzaPaymentsReportPdfAsync(report, {
        visibleCols: columnVisibility.visibleCols,
      }),
    [report, columnVisibility.visibleCols],
  );

  function togglePaymentSort(key: PaymentSortKey) {
    if (paymentSortKey === key) {
      setPaymentSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setPaymentSortKey(key);
    setPaymentSortDir(key === "fecha" || key === "valor" ? "desc" : "asc");
  }

  const visibleHeaders = SORT_HEADERS.filter((header) => columnVisibility.isVisible(header.id));

  const periodHint = useMemo(() => {
    if (fromIso === toIso) return "Un solo día";
    const start = Date.parse(`${fromIso}T12:00:00`);
    const end = Date.parse(`${toIso}T12:00:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Rango de fechas";
    const days = Math.round((end - start) / 86_400_000) + 1;
    return `${days} día${days === 1 ? "" : "s"}`;
  }, [fromIso, toIso]);

  return (
    <>
      <section className="panel cobranza-payments-view">
        <div className="head">
          <h1>{title}</h1>
          <span className="count">{sorted.length}</span>
          <div className="grow" />
          <button type="button" className="btn primary" onClick={() => setPdfPreviewOpen(true)}>
            Vista previa PDF
          </button>
        </div>

        <div className="filters cobranza-report-filters">
          <label>
            Desde
            <input
              type="date"
              value={fromIso}
              max={toIso}
              onChange={(event) => setFromIso(event.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={toIso}
              min={fromIso}
              onChange={(event) => setToIso(event.target.value)}
            />
          </label>
          <label>
            Cobrador
            <select
              value={collectorFilter}
              onChange={(event) => setCollectorFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {collectors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="kpis tone-kpis cobranza-report-kpis">
          <Kpi
            label="Periodo"
            value={report.periodLabel}
            hint={periodHint}
            tone="teal"
          />
          <Kpi
            label="Movimientos"
            value={String(filtered.length)}
            hint={collectorFilter ? `Cobrador: ${collectorFilter}` : "Todos los cobradores"}
            tone="sage"
          />
          <Kpi label="Total recaudado" value={money(total)} hint="En el periodo filtrado" tone="amber" />
        </div>

        <div className="table-wrap">
          <table className="data list-grid">
          <thead>
            <tr className="col-titles">
                {visibleHeaders.map((header) => {
                  const active = "sortKey" in header && header.sortKey === paymentSortKey;
                  const className = [
                    "right" in header && header.right ? "right" : undefined,
                    "sortKey" in header && header.sortKey ? "sortable" : undefined,
                    active ? "sorted" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const label =
                    "sortKey" in header && header.sortKey ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => togglePaymentSort(header.sortKey as PaymentSortKey)}
                      >
                        <span className="th-sort-arrow" aria-hidden>
                          {active ? (paymentSortDir === "asc" ? "▲" : "▼") : "▲"}
                        </span>
                        {header.t}
                      </button>
                    ) : (
                      header.t
                    );

                  return (
                    <th
                      key={header.id}
                      className={className || undefined}
                      aria-sort={
                        active
                          ? paymentSortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {label}
                    </th>
                  );
                })}
                <ColumnPickerHeadCell>
                  <ColumnPicker
                    columns={COBRANZA_PAYMENT_COLUMNS}
                    visibleCols={columnVisibility.visibleCols}
                    onToggle={columnVisibility.toggleColumn}
                  />
                </ColumnPickerHeadCell>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={visibleHeaders.length + 1}>Sin registros en este periodo.</td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr key={row.ref}>
                    {columnVisibility.isVisible("ref") ? (
                      <td>
                        <PaymentRefLink refCode={row.ref} onOpen={onOpenPayment} />
                      </td>
                    ) : null}
                    {columnVisibility.isVisible("fecha") ? <td>{row.when}</td> : null}
                    {columnVisibility.isVisible("cliente") ? <td>{row.client}</td> : null}
                    {columnVisibility.isVisible("cobrador") ? <td>{row.collector}</td> : null}
                    {columnVisibility.isVisible("valor") ? (
                      <td className="money right">{money(row.amount)}</td>
                    ) : null}
                    {columnVisibility.isVisible("method") ? (
                      <td>
                        <Pill
                          label={paymentMethodLabel(row.method)}
                          kind={paymentMethodKind(normalizePaymentMethod(row.method))}
                        />
                      </td>
                    ) : null}
                    {columnVisibility.isVisible("evidence") ? (
                      <td className="pay-evidence-cell">
                        <PaymentEvidenceThumb evidence={row.evidence} size={22} />
                      </td>
                    ) : null}
                    {columnVisibility.isVisible("tipo") ? <td>{row.type}</td> : null}
                    {columnVisibility.isVisible("estado") ? (
                      <td>
                        <PaymentStatusPill
                          payment={row}
                          loan={row.loanRef ? loanMap.get(row.loanRef) : undefined}
                        />
                      </td>
                    ) : null}
                    <ColumnPickerBodyCell />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pdfPreviewOpen ? (
        <ReportPdfPreview
          title="Vista previa del informe"
          subtitle={`${report.title} · ${report.periodLabel} · ${report.summary.count} movimiento${report.summary.count === 1 ? "" : "s"}`}
          fileName={cobranzaPaymentsReportFileName(report)}
          buildBlob={buildPdfBlob}
          onDownload={downloadPdf}
          onClose={() => setPdfPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
