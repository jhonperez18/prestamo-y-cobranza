"use client";

import { useMemo, useState } from "react";
import { Kpi, Pill } from "@/components/ui";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import { readWelcomeMessage } from "@/lib/welcome-message";
import { money } from "@/lib/mock-data";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import { loansByRef } from "@/lib/payment-detail";
import { normalizePaymentMethod, paymentMethodKind, paymentMethodLabel } from "@/lib/payment-method";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import type { ModuleId } from "@/lib/navigation";
import type {
  ActivityRow,
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
} from "@/lib/mock-data";

type Props = {
  adminName: string;
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  activities: ActivityRow[];
  onGo: (moduleId: ModuleId, viewId?: string) => void;
};

function activityWhenParts(when: string) {
  const [date, time] = when.split(" · ");
  return { date: date?.trim() ?? when, time: time?.trim() ?? "" };
}

export function HomeDashboard({
  adminName,
  clients,
  loans,
  payments,
  routes,
  collectors,
  activities,
  onGo,
}: Props) {
  const data = useMemo(
    () => buildHomeDashboard(clients, loans, payments, routes, collectors, activities),
    [activities, clients, collectors, loans, payments, routes],
  );
  const loanMap = useMemo(() => loansByRef(loans), [loans]);
  const [welcomeConfig] = useState(() => readWelcomeMessage());

  return (
    <div className="home-dashboard">
      <WelcomeBanner
        config={welcomeConfig}
        adminName={adminName}
        dateLabel={data.dateLabel}
      />

      <div className="kpis tone-kpis home-kpis">
        <Kpi
          label="Cobrado hoy"
          value={money(data.collectedToday)}
          hint={`${data.collectedCount} operacion${data.collectedCount === 1 ? "" : "es"}`}
          tone="amber"
          onClick={() => onGo("cobranza", "hoy")}
        />
        <Kpi
          label="Por cobrar hoy"
          value={money(data.dueToday)}
          hint={`${data.pendingVisits} visita${data.pendingVisits === 1 ? "" : "s"} pendiente${data.pendingVisits === 1 ? "" : "s"}`}
          tone="teal"
          onClick={() => onGo("cobranza", "hoy")}
        />
        <Kpi
          label="En mora"
          value={money(data.moraTotal)}
          hint={`${data.moraCount} crédito${data.moraCount === 1 ? "" : "s"}`}
          tone="coral"
          onClick={() => onGo("cartera", "mora")}
        />
        <Kpi
          label="Clientes activos"
          value={String(data.activeClients)}
          hint={`${data.activeLoansCount} préstamos · ${money(data.portfolioTotal)}`}
          tone="sage"
          onClick={() => onGo("clientes", "activos")}
        />
      </div>

      <div className="home-split">
        <section className="panel home-pending home-pending-compact">
          <div className="head">
            <h2>Pendientes</h2>
            <span className="count">{data.pendingActions.length}</span>
          </div>
          <ul className="home-pending-list">
            {data.pendingActions.map((item) => (
              <li key={item.id}>
                <div className="home-pending-copy">
                  <Pill label={item.pill} kind={item.kind} />
                  <span>{item.message}</span>
                </div>
                {item.id !== "ok" ? (
                  <button type="button" className="btn-bar home-go" onClick={() => onGo(item.module, item.view)}>
                    Ir
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel home-activity home-activity-side">
          <div className="head">
            <h2>Actividad reciente</h2>
            <span className="count">{data.recentActivity.length}</span>
          </div>
          {data.recentActivity.length ? (
            <ul className="home-activity-list">
              {data.recentActivity.map((row) => {
                const when = activityWhenParts(row.when);
                return (
                  <li className="home-activity-item" key={row.ref}>
                    <time className="home-ev-when">
                      <span>{when.date}</span>
                      {when.time ? <span>{when.time}</span> : null}
                    </time>
                    <div className="home-ev-body">
                      <div className="home-ev-line">
                        <strong>{row.title}</strong>
                        <span className="home-ev-sep">·</span>
                        <span>{row.detail}</span>
                        {row.gps ? <Pill label="GPS" kind="ok" /> : null}
                      </div>
                      <span className="home-ev-meta">{row.collectorName}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="home-empty">Sin actividad registrada todavía.</p>
          )}
          <div className="home-panel-foot">
            <button type="button" className="btn ghost" onClick={() => onGo("inicio", "actividad")}>
              Ver toda la actividad
            </button>
          </div>
        </section>
      </div>

      <div className="grid-2 home-grid">
        <section className="panel home-payments">
          <div className="head">
            <h2>Cobros del día</h2>
            <span className="count">{data.collectedCount}</span>
          </div>
          {data.todayPayments.length ? (
            <div className="table-wrap">
              <table className="data compact home-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Cobrador</th>
                    <th>Forma de pago</th>
                    <th>Comprobante</th>
                    <th className="right">Valor</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.todayPayments.map((row) => (
                    <tr key={row.ref}>
                      <td>{row.when.split(" · ").pop() ?? row.when}</td>
                      <td>{row.client}</td>
                      <td>{row.collector}</td>
                      <td>
                        <Pill
                          label={paymentMethodLabel(row.method)}
                          kind={paymentMethodKind(normalizePaymentMethod(row.method))}
                        />
                      </td>
                      <td>
                        <PaymentEvidenceThumb evidence={row.evidence} size={32} />
                      </td>
                      <td className="money right">{money(row.amount)}</td>
                      <td>
                        <PaymentStatusPill
                          payment={row}
                          loan={row.loanRef ? loanMap.get(row.loanRef) : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="home-empty">
              Aún no hay cobros hoy. Despacha rutas en{" "}
              <button type="button" className="home-link" onClick={() => onGo("cobranza", "hoy")}>
                Cobranza
              </button>
              .
            </p>
          )}
          <div className="home-panel-foot">
            <button type="button" className="btn ghost" onClick={() => onGo("cobranza", "hoy")}>
              Ver cobranza del día
            </button>
          </div>
        </section>

        <section className="panel home-routes">
          <div className="head">
            <h2>Rutas en campo</h2>
            <span className="count">{data.routes.length}</span>
          </div>
          {data.routes.length ? (
            <ul className="home-route-list">
              {data.routes.map((route) => (
                <li key={route.ref}>
                  <div className="home-route-top">
                    <div>
                      <strong>{route.zone}</strong>
                      <span>
                        {route.collector} · {route.visited}/{route.clients} clientes
                      </span>
                    </div>
                    <Pill label={route.status} kind={route.statusKind} />
                  </div>
                  <div className="home-progress" aria-hidden>
                    <i style={{ width: `${route.progress}%` }} />
                  </div>
                  <span className="home-progress-label">
                    {route.progress}% visitado · {route.pending} pendiente{route.pending === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-empty">No hay rutas activas. Configúralas en Ruta del día.</p>
          )}
          <div className="home-panel-foot">
            <button type="button" className="btn ghost" onClick={() => onGo("inicio", "lista")}>
              Gestionar rutas
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
