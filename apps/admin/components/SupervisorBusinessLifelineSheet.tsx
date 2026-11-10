"use client";

/**
 * Hoja dedicada: Salvavidas del negocio.
 * Fuera de Caja / Banco / Nequi. Solo muestra descuadres del servidor.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  BusinessAlarm,
  BusinessLifelineReport,
} from "@/lib/business-lifeline-types";
import { formatAlarmMoneyLine } from "@/lib/business-lifeline-types";

type Props = {
  onClose: () => void;
};

function money(n: number) {
  return Math.trunc(n).toLocaleString("es-CO");
}

export function SupervisorBusinessLifelineSheet({ onClose }: Props) {
  const [report, setReport] = useState<BusinessLifelineReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ops/business-lifeline", { cache: "no-store" });
      const body = (await res.json()) as BusinessLifelineReport;
      if (!body || !Array.isArray(body.alarms)) {
        setError(body?.error || "No se pudo leer el salvavidas");
        setReport(null);
        return;
      }
      setReport(body);
    } catch (err) {
      console.error("supervisor-lifeline", err);
      setError("Sin red o el servidor no contestó");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const alarms = report?.alarms ?? [];
  const critical = alarms.filter((row) => row.severity === "critical").length;

  return (
    <section className="supervisor-lifeline" aria-label="Salvavidas del negocio">
      <header className="supervisor-lifeline-head">
        <button type="button" className="supervisor-lifeline-back" onClick={onClose}>
          Volver
        </button>
        <div className="supervisor-lifeline-titles">
          <h2>Salvavidas</h2>
          <p>Descuadres de Caja · solo servidor</p>
        </div>
        <button
          type="button"
          className="supervisor-lifeline-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "…" : "Revisar"}
        </button>
      </header>

      {loading && !report ? (
        <p className="supervisor-lifeline-empty">Revisando la nube…</p>
      ) : null}

      {error ? <p className="supervisor-lifeline-error">{error}</p> : null}

      {report && report.ok && alarms.length === 0 ? (
        <div className="supervisor-lifeline-ok" role="status">
          <b>Todo cuadra</b>
          <span>
            CIE = fórmula = Inicial · {report.businessDate}
          </span>
        </div>
      ) : null}

      {alarms.length > 0 ? (
        <div className="supervisor-lifeline-summary" role="status">
          <b>
            {critical} crítica{critical === 1 ? "" : "s"}
          </b>
          <span>{alarms.length} alerta{alarms.length === 1 ? "" : "s"} · {report?.businessDate}</span>
        </div>
      ) : null}

      <ul className="supervisor-lifeline-list">
        {alarms.map((alarm) => (
          <AlarmCard key={alarm.id} alarm={alarm} />
        ))}
      </ul>

      <p className="supervisor-lifeline-foot">
        Fórmula: Inicial + efectivo − préstamos − gastos. Banco no entra. Si hay alerta, el
        sello o el Inicial no coinciden con la operación del día.
      </p>
    </section>
  );
}

function AlarmCard({ alarm }: { alarm: BusinessAlarm }) {
  return (
    <li
      className={
        alarm.severity === "critical"
          ? "supervisor-lifeline-card is-critical"
          : "supervisor-lifeline-card is-warn"
      }
    >
      <div className="supervisor-lifeline-card-top">
        <span className="supervisor-lifeline-badge">
          {alarm.severity === "critical" ? "CRÍTICA" : "AVISO"}
        </span>
        <span className="supervisor-lifeline-date">{alarm.date}</span>
      </div>
      <h3>{alarm.title}</h3>
      <p className="supervisor-lifeline-money">{formatAlarmMoneyLine(alarm)}</p>
      {alarm.code !== "audit_error" ? (
        <p className="supervisor-lifeline-diff">
          Diferencia {money(Math.abs(alarm.expected - alarm.actual))}
        </p>
      ) : null}
      <p className="supervisor-lifeline-detail">{alarm.detail}</p>
    </li>
  );
}
