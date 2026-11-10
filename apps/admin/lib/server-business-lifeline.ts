/**
 * Salvavidas del negocio — detector de descuadres de Caja.
 *
 * Dueño 10/11: una sola fórmula, un solo Saldo. Si algo no cuadra, aquí sale.
 * Solo lee (chain-audit + day_cash_figure + route_own_box). No escribe.
 * Prohibido inventar cifras: el veredicto sale de la misma puerta que verify:prod.
 */
import type {
  BusinessAlarm,
  BusinessLifelineReport,
} from "@/lib/business-lifeline-types";
import { businessTodayIso } from "@/lib/business-timezone";
import { cajaFormulaSaldo } from "@/lib/planilla-header-cash";
import { runServerChainAudit, type ChainAuditRow } from "@/lib/server-chain-audit";
import { readDayCashFigure } from "@/lib/server-day-cash-figure";
import { readRouteOwnBox } from "@/lib/server-route-own-box";

export type { BusinessAlarm, BusinessLifelineReport } from "@/lib/business-lifeline-types";

function alarmId(parts: string[]) {
  return parts.join("|");
}

/**
 * Arrastre sellado: CIE/caja del día ancla vs fórmula (respeta AJUSTE)
 * e Inicial de hoy vs ese cierre.
 */
function fromChainRow(row: ChainAuditRow): BusinessAlarm[] {
  const out: BusinessAlarm[] = [];
  if (!row.sealOk) {
    const formula = row.yesterdayFormula;
    if (row.kind === "independent" && row.cloudCieFloat !== row.yesterdayCieFloat) {
      out.push({
        id: alarmId([row.collectorRef, row.yesterday, "cie_vs_caja"]),
        severity: "critical",
        code: "cie_vs_formula",
        collectorRef: row.collectorRef,
        collectorName: row.collectorName,
        date: row.yesterday,
        title: `${row.collectorName}: CIE ≠ Caja propia`,
        detail: `Día ${row.yesterday}. El CIE debe guardar la misma Caja (Inicial+efectivo−préstamos−gastos).`,
        expected: row.yesterdayCieFloat,
        actual: row.cloudCieFloat,
        kind: row.kind,
      });
    } else if (formula != null && formula !== row.cloudCieFloat) {
      out.push({
        id: alarmId([row.collectorRef, row.yesterday, "cie_vs_formula"]),
        severity: "critical",
        code: "cie_vs_formula",
        collectorRef: row.collectorRef,
        collectorName: row.collectorName,
        date: row.yesterday,
        title: `${row.collectorName}: CIE ≠ fórmula de Caja`,
        detail: `Día ${row.yesterday}. Caja debe ser Inicial+efectivo−préstamos−gastos. Banco no entra. (AJUSTE autorizado no dispara esto.)`,
        expected: formula,
        actual: row.cloudCieFloat,
        kind: row.kind,
      });
    } else if (formula != null && formula !== row.yesterdayCieFloat) {
      out.push({
        id: alarmId([row.collectorRef, row.yesterday, "caja_vs_formula"]),
        severity: "critical",
        code: "cie_vs_formula",
        collectorRef: row.collectorRef,
        collectorName: row.collectorName,
        date: row.yesterday,
        title: `${row.collectorName}: Caja ≠ fórmula`,
        detail: `Día ${row.yesterday}. Caja propia no cuadra con Inicial+efectivo−préstamos−gastos.`,
        expected: formula,
        actual: row.yesterdayCieFloat,
        kind: row.kind,
      });
    }
  }
  if (!row.openingOk && row.todayOpening != null) {
    out.push({
      id: alarmId([row.collectorRef, row.yesterday, "inicial_vs_cie"]),
      severity: "critical",
      code: "inicial_vs_cie",
      collectorRef: row.collectorRef,
      collectorName: row.collectorName,
      date: row.yesterday,
      title: `${row.collectorName}: Inicial de hoy ≠ cierre de ayer`,
      detail: `El Inicial de hoy debe ser el Saldo sellado del ${row.yesterday}.`,
      expected: row.yesterdayCieFloat,
      actual: row.todayOpening,
      kind: row.kind,
    });
  }
  return out;
}

async function liveDayAlarms(
  collectorRef: string,
  collectorName: string,
  date: string,
  kind: "chain" | "independent",
): Promise<BusinessAlarm[]> {
  const out: BusinessAlarm[] = [];
  if (kind === "chain") {
    const fig = await readDayCashFigure(collectorRef, date);
    if (!fig.ok || !fig.ready || !fig.chain) return out;
    const mFormula = cajaFormulaSaldo(
      fig.opening,
      fig.mEfectivo,
      fig.mPrestamos,
      fig.mGastos,
    );
    if (mFormula !== fig.mClosing) {
      out.push({
        id: alarmId([collectorRef, date, "m_caja_vs_formula"]),
        severity: "critical",
        code: "m_caja_vs_formula",
        collectorRef,
        collectorName,
        date,
        title: `${collectorName}: Caja M no cuadra con la fórmula`,
        detail: `M ${date}: Inicial+efectivo−préstamos−gastos debe = Caja M.`,
        expected: mFormula,
        actual: fig.mClosing,
        kind: "chain",
      });
    }
    const tFormula = cajaFormulaSaldo(
      fig.mClosing,
      fig.tEfectivo,
      fig.tPrestamos,
      fig.tGastos,
    );
    if (tFormula !== fig.dayFinal) {
      out.push({
        id: alarmId([collectorRef, date, "t_caja_vs_formula"]),
        severity: "critical",
        code: "t_caja_vs_formula",
        collectorRef,
        collectorName,
        date,
        title: `${collectorName}: Caja T / saldo del día no cuadra`,
        detail: `T ${date}: Inicial T(=Caja M)+efectivo−préstamos−gastos debe = saldo del día.`,
        expected: tFormula,
        actual: fig.dayFinal,
        kind: "chain",
      });
    }
    return out;
  }

  for (const route of ["N", "A"] as const) {
    const box = await readRouteOwnBox(collectorRef, date, route);
    if (!box.ok) continue;
    const formula = cajaFormulaSaldo(
      box.opening,
      box.efectivo,
      box.prestamos,
      box.gastos,
    );
    if (formula !== box.saldo) {
      out.push({
        id: alarmId([collectorRef, date, route, "an_caja_vs_formula"]),
        severity: "critical",
        code: "an_caja_vs_formula",
        collectorRef,
        collectorName,
        date,
        title: `${collectorName}: Caja ${route} ≠ fórmula`,
        detail: `Ruta ${route} · ${date}. Banco/Nequi no entran a Caja.`,
        expected: formula,
        actual: box.saldo,
        kind: "independent",
      });
    }
  }
  return out;
}

/** Corre el salvavidas: arrastre + fórmula del día ancla + consistencia del día vivo. */
export async function runBusinessLifeline(
  now = new Date(),
): Promise<BusinessLifelineReport> {
  const businessDate = businessTodayIso(now);
  const checkedAt = now.toISOString();
  try {
    const audit = await runServerChainAudit(now);
    const alarms: BusinessAlarm[] = [];

    if (audit.error && !audit.rows.length) {
      return {
        ok: false,
        businessDate,
        checkedAt,
        alarms: [
          {
            id: "system|audit_error",
            severity: "critical",
            code: "audit_error",
            collectorRef: "",
            collectorName: "Sistema",
            date: businessDate,
            title: "No se pudo auditar la Caja",
            detail: audit.error,
            expected: 0,
            actual: 0,
            kind: "system",
          },
        ],
        error: audit.error,
      };
    }

    for (const row of audit.rows) {
      alarms.push(...fromChainRow(row));
      // Día ancla (ayer): la misma puerta del libro / caja propia.
      alarms.push(
        ...(await liveDayAlarms(
          row.collectorRef,
          row.collectorName,
          row.yesterday,
          row.kind,
        )),
      );
      // Día vivo (hoy): Caja M/T o A/N no puede divergir de la fórmula.
      alarms.push(
        ...(await liveDayAlarms(
          row.collectorRef,
          row.collectorName,
          businessDate,
          row.kind,
        )),
      );
      if (
        !row.ok &&
        !alarms.some(
          (a) =>
            a.collectorRef === row.collectorRef &&
            (a.code === "cie_vs_formula" ||
              a.code === "inicial_vs_cie" ||
              a.code === "m_caja_vs_formula" ||
              a.code === "t_caja_vs_formula" ||
              a.code === "an_caja_vs_formula"),
        )
      ) {
        alarms.push({
          id: alarmId([row.collectorRef, row.yesterday, "audit_row_fail"]),
          severity: "critical",
          code: "inicial_vs_cie",
          collectorRef: row.collectorRef,
          collectorName: row.collectorName,
          date: row.yesterday,
          title: `${row.collectorName}: arrastre de Caja no cuadra`,
          detail: `CIE ${row.yesterday} / Inicial hoy / fórmula no cierran la cadena.`,
          expected: row.yesterdayCieFloat,
          actual: row.todayOpening ?? 0,
          kind: row.kind,
        });
      }
    }

    const byId = new Map<string, BusinessAlarm>();
    for (const row of alarms) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    const unique = [...byId.values()].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return a.date.localeCompare(b.date) || a.collectorName.localeCompare(b.collectorName);
    });

    return {
      ok: unique.length === 0,
      businessDate,
      checkedAt,
      alarms: unique,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "lifeline_failed";
    console.error("business-lifeline", error);
    return {
      ok: false,
      businessDate,
      checkedAt,
      alarms: [
        {
          id: "system|audit_error",
          severity: "critical",
          code: "audit_error",
          collectorRef: "",
          collectorName: "Sistema",
          date: businessDate,
          title: "Fallo al correr el salvavidas",
          detail: message,
          expected: 0,
          actual: 0,
          kind: "system",
        },
      ],
      error: message,
    };
  }
}
