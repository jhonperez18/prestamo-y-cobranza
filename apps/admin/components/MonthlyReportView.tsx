"use client";

/**
 * Reportes → Informes → Mensual.
 * Una ruta, un mes. Solo pinta pagos y la ficha. No guarda nada.
 */
import { useEffect, useMemo, useState } from "react";
import { businessTodayIso } from "@/lib/business-timezone";
import { weekdayLabel } from "@/lib/colombia-holidays";
import { isoToDisplay } from "@/lib/loan-preview";
import {
  buildMonthlyRouteSheet,
  isMonthlyRouteName,
  monthLabel,
  monthStartIso,
  closedMonths,
  sheetMiles,
  type MonthlyRouteName,
  type MonthSheetCell,
} from "@/lib/monthly-route-sheet";
import { money, type PaymentRow } from "@/lib/mock-data";
import { useRouteSheet } from "@/lib/use-route-sheet";
import type { PaymentMirrorRow } from "@/lib/supabase/payment-mirror";
import styles from "./MonthlyReportView.module.css";

const ROUTES: MonthlyRouteName[] = ["M", "T", "N", "A"];

const payCache = new Map<string, PaymentRow[]>();

function paymentFromMirror(row: PaymentMirrorRow): PaymentRow | null {
  const ref = (row.ref || "").trim();
  const loanRef = (row.loan_ref || "").trim();
  const paidDate = (row.paid_date || "").slice(0, 10);
  const amount = Number(row.amount);
  if (!ref || !loanRef || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || !(amount > 0)) return null;
  const type = row.payment_type?.trim() || "Cuota";
  const voided = type === "Anulado" || (row.charge_label || "").startsWith("ANULADO:");
  return {
    ref,
    loanRef,
    paidDate,
    amount,
    type: voided ? "Anulado" : type,
    when: paidDate,
    client: "",
    collector: "",
    kind: "pending",
  };
}

function miles(value: number) {
  return sheetMiles(value) || "0";
}

function pesos(value: number) {
  return money(value, { symbol: false });
}

function cellTitle(cell: MonthSheetCell) {
  if (cell.kind === "renewal") return "Renovación: total del préstamo nuevo. De aquí se resta lo que pague después.";
  if (cell.kind === "loan") return "Préstamo nuevo. De aquí se resta lo que pague después.";
  return "Pago del día";
}

export function MonthlyReportView() {
  const today = businessTodayIso();
  const months = useMemo(() => closedMonths(today), [today]);
  const currentMonth = today.slice(0, 7);
  const [route, setRoute] = useState<MonthlyRouteName>("M");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);
  const month = historyOpen && historyMonth ? historyMonth : currentMonth;
  const showSheet = !historyOpen || historyMonth !== null;
  const sheetBook = useRouteSheet(true);
  const [payments, setPayments] = useState<PaymentRow[] | null>(() => payCache.get(monthStartIso(today.slice(0, 7))) ?? null);
  const [payState, setPayState] = useState<"ready" | "loading" | "error">(
    payCache.has(monthStartIso(today.slice(0, 7))) ? "ready" : "loading",
  );

  useEffect(() => {
    const from = monthStartIso(month);
    const cached = payCache.get(from);
    if (cached) {
      setPayments(cached);
      setPayState("ready");
      return;
    }
    let alive = true;
    setPayState("loading");
    setPayments(null);
    void (async () => {
      try {
        const res = await fetch(`/api/payments?fromDate=${from}&toDate=${today}`, { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; payments?: PaymentMirrorRow[] };
        if (!res.ok || !body.ok) throw new Error("payments");
        const rows = (body.payments ?? [])
          .map(paymentFromMirror)
          .filter((row): row is PaymentRow => Boolean(row));
        payCache.set(from, rows);
        if (!alive) return;
        setPayments(rows);
        setPayState("ready");
      } catch {
        if (!alive) return;
        setPayState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, today]);

  const book = sheetBook.sheet;
  const sheet = useMemo(() => {
    if (!book || !payments || !isMonthlyRouteName(route)) return null;
    return buildMonthlyRouteSheet({
      route,
      month,
      today,
      clients: book.clients,
      loans: book.loans,
      payments,
    });
  }, [book, payments, route, month, today]);

  const loading = sheetBook.status === "loading" || payState === "loading";
  const failed = sheetBook.status === "error" || payState === "error";

  return (
    <section className="panel weekly-report">
      <div className={styles.head}>
        <div className="weekly-report-scopes" role="tablist" aria-label="Ruta">
          {ROUTES.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={route === name}
              className={route === name ? "on" : undefined}
              onClick={() => setRoute(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="weekly-report-scopes" role="group" aria-label="Mes">
          <button
            type="button"
            className={historyOpen ? "on" : undefined}
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryMonth(null);
              setHistoryOpen((open) => !open);
            }}
          >
            Historial
          </button>
        </div>
        {showSheet ? <strong>{monthLabel(month)}</strong> : null}
      </div>
      {historyOpen ? (
        months.length === 0 ? (
          <p className={styles.note}>Todavía no hay un mes cerrado.</p>
        ) : (
          <div className={`weekly-report-scopes ${styles.months}`}>
            {months.map((item) => (
              <button
                key={item}
                type="button"
                className={item === historyMonth ? "on" : undefined}
                onClick={() => setHistoryMonth(item)}
              >
                {monthLabel(item)}
              </button>
            ))}
          </div>
        )
      ) : null}
      {showSheet ? (
      <>
      {loading ? (
        <p className="ficha-empty">Cargando la hoja del sistema…</p>
      ) : failed || !sheet ? (
        <p className="ficha-empty">No se pudo cargar la hoja del sistema.</p>
      ) : sheet.rows.length === 0 ? (
        <p className="ficha-empty">Sin saldo en la ruta {route} este mes.</p>
      ) : (
        <>
        <div className={styles.saldoTotal}>
          {pesos(sheet.rows.reduce((sum, row) => sum + (Number(row.saldo) || 0), 0))}
        </div>
        <div className={styles.wrap}>
          <table className={`data ${styles.table}`}>
            <colgroup>
              <col className={styles.colPos} />
              <col className={styles.colName} />
              <col className={styles.colSum} />
              {sheet.days.map((iso) => (
                <col key={iso} />
              ))}
              <col className={styles.colSum} />
            </colgroup>
            <thead>
              <tr className="col-titles">
                <th className={styles.pos}>#</th>
                <th className="is-nombre">Nombre</th>
                <th className={styles.sum}>Inicial</th>
                {sheet.days.map((iso) => (
                  <th key={iso} className={styles.day} title={`${weekdayLabel(iso)} ${isoToDisplay(iso)}`}>
                    {Number(iso.slice(8, 10))}
                  </th>
                ))}
                <th className={styles.sum}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.clientRef}>
                  <td className={styles.pos}>{row.order || ""}</td>
                  <td className="is-nombre" title={row.name}>{row.name}</td>
                  <td className={styles.sum}>{pesos(row.inicial)}</td>
                  {row.cells.map((cell, index) => (
                    <td
                      key={sheet.days[index] ?? index}
                      className={
                        cell?.kind === "renewal"
                          ? `${styles.day} ${styles.renewal}`
                          : cell?.kind === "loan"
                            ? `${styles.day} ${styles.loan}`
                            : styles.day
                      }
                      title={cell ? cellTitle(cell) : "No pagó"}
                    >
                      {cell ? miles(cell.amount) : "-"}
                    </td>
                  ))}
                  <td className={styles.sum}>{pesos(row.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      </>
      ) : null}
    </section>
  );
}
