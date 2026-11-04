"use client";

/**
 * Reportes → Informes → Mensual.
 * Una ruta, un mes. Solo lectura: cobros por día de cada cliente de la ruta.
 *
 * El sistema principal ya tiene clientes / préstamos / cobros en el aparato.
 * Pinta con eso al instante. La nube puede refrescar cobros atrás; no bloquea la hoja.
 */
import { useEffect, useMemo, useState } from "react";
import { businessTodayIso } from "@/lib/business-timezone";
import { weekdayLabel } from "@/lib/colombia-holidays";
import {
  DEMO_CLIENTS_KEY,
  DEMO_LOANS_KEY,
  loadDemoPayments,
  readDemoJson,
} from "@/lib/demo-persist";
import { isoToDisplay } from "@/lib/loan-preview";
import { isPaymentLive } from "@/lib/live-payments";
import {
  buildMonthlyRouteSheet,
  isMonthlyRouteName,
  monthEndIso,
  monthLabel,
  monthStartIso,
  closedMonths,
  sheetMiles,
  type MonthlyRouteName,
  type MonthSheetCell,
} from "@/lib/monthly-route-sheet";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { isClientDeletedStatus, isLoanDeletedStatus } from "@/lib/supabase/catalog-mirror";
import type { PaymentMirrorRow } from "@/lib/supabase/payment-mirror";
import styles from "./MonthlyReportView.module.css";

const ROUTES: MonthlyRouteName[] = ["M", "T", "N", "A"];

const payCloudCache = new Map<string, PaymentRow[]>();
const PAY_FETCH_MS = 12_000;

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

function localClients(): ClientRow[] {
  return readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []).filter(
    (row) => !isClientDeletedStatus(row),
  );
}

function localLoans(): LoanRow[] {
  return readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []).filter(
    (row) => !isLoanDeletedStatus(row),
  );
}

function paymentsInMonth(rows: PaymentRow[], month: string, today: string): PaymentRow[] {
  const from = monthStartIso(month);
  const end = monthEndIso(month);
  const to = end < today ? end : today;
  return rows.filter((row) => {
    if (!isPaymentLive(row)) return false;
    const paid = (row.paidDate || "").slice(0, 10);
    return paid >= from && paid <= to;
  });
}

function localMonthPayments(month: string, today: string): PaymentRow[] {
  return paymentsInMonth(loadDemoPayments(), month, today);
}

function miles(value: number) {
  return sheetMiles(value) || "0";
}

function pesos(value: number) {
  return money(value, { symbol: false });
}

function cellTitle(cell: MonthSheetCell) {
  if (cell.kind === "renewal") {
    return "Renovación: total del préstamo nuevo. De aquí se resta lo que pague después.";
  }
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

  const [clients, setClients] = useState<ClientRow[]>(() => localClients());
  const [loans, setLoans] = useState<LoanRow[]>(() => localLoans());
  const [payments, setPayments] = useState<PaymentRow[]>(() =>
    payCloudCache.get(monthStartIso(currentMonth)) ?? localMonthPayments(currentMonth, today),
  );
  const [cloudNote, setCloudNote] = useState<string | null>(null);

  // Catálogo del aparato: si llega tarde el IndexedDB, relee una vez al montar.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setClients(localClients());
      setLoans(localLoans());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Cobros del mes: primero local; la nube refresca con tope (no cuelga la hoja).
  useEffect(() => {
    const from = monthStartIso(month);
    const cached = payCloudCache.get(from);
    if (cached) {
      setPayments(cached);
      setCloudNote(null);
    } else {
      setPayments(localMonthPayments(month, today));
    }

    let alive = true;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer =
      ctrl && typeof window !== "undefined"
        ? window.setTimeout(() => ctrl.abort(), PAY_FETCH_MS)
        : 0;

    void (async () => {
      try {
        const res = await fetch(`/api/payments?fromDate=${from}&toDate=${today}`, {
          cache: "no-store",
          signal: ctrl?.signal,
        });
        const body = (await res.json()) as { ok?: boolean; payments?: PaymentMirrorRow[] };
        if (!res.ok || !body.ok) throw new Error("payments");
        const rows = (body.payments ?? [])
          .map(paymentFromMirror)
          .filter((row): row is PaymentRow => Boolean(row));
        payCloudCache.set(from, rows);
        if (!alive) return;
        setPayments(rows);
        setCloudNote(null);
      } catch {
        if (!alive) return;
        // Local ya pinta: solo aviso si no hay nada en el aparato.
        if (!localMonthPayments(month, today).length) {
          setCloudNote("Sin cobros de la nube todavía; se muestra lo del aparato.");
        }
      } finally {
        if (timer) window.clearTimeout(timer);
      }
    })();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      ctrl?.abort();
    };
  }, [month, today]);

  const sheet = useMemo(() => {
    if (!isMonthlyRouteName(route)) return null;
    if (!clients.length) return null;
    return buildMonthlyRouteSheet({
      route,
      month,
      today,
      clients,
      loans,
      payments,
    });
  }, [clients, loans, payments, route, month, today]);

  const waitingCatalog = clients.length === 0;

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
          {waitingCatalog ? (
            <p className="ficha-empty">Cargando clientes del sistema…</p>
          ) : !sheet ? (
            <p className="ficha-empty">No se pudo armar la hoja de la ruta {route}.</p>
          ) : sheet.rows.length === 0 ? (
            <p className="ficha-empty">Sin clientes en la ruta {route}.</p>
          ) : (
            <>
              {cloudNote ? <p className={styles.note}>{cloudNote}</p> : null}
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
                        <th
                          key={iso}
                          className={
                            iso === today ? `${styles.day} ${styles.today}` : styles.day
                          }
                          title={`${weekdayLabel(iso)} ${isoToDisplay(iso)}`}
                        >
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
                        <td className="is-nombre" title={row.name}>
                          {row.name}
                        </td>
                        <td className={styles.sum}>{pesos(row.inicial)}</td>
                        {row.cells.map((cell, index) => (
                          <td
                            key={sheet.days[index] ?? index}
                            className={[
                              styles.day,
                              sheet.days[index] === today ? styles.today : "",
                              cell?.kind === "renewal" ? styles.renewal : "",
                              cell?.kind === "loan" ? styles.loan : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
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
