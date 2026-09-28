/**
 * Ajuste de saldo real en T — único camino (supervisor / admin).
 *
 * Ventana: solo hoy (America/Bogota), con el CIE- de hoy ya sellado (T cerró),
 * antes de medianoche. Fuera de eso hay que esperar el próximo cierre de T.
 *
 * Toca solo el CIE- de hoy y su eslabón PCE-T. Cuotas, préstamos, pagos, rutas,
 * clientes, planillas y días pasados no se tocan.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import type { CashAdjustment, CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { pesos } from "@/lib/finance";
import {
  findFullDayCieClose,
  planillaCashCloseRef,
  PLANILLA_CASH_CHAIN_SECONDARY,
  projectPceTFromDayCloses,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";

export type CashAdjustmentWindow =
  | { open: true; date: string; cie: CollectorDayCloseRecord }
  | { open: false; reason: string };

/** ¿Se puede ajustar ahora el saldo de T de este cobrador? */
export function cashAdjustmentWindow(
  collectorRef: string,
  dayCloses: CollectorDayCloseRecord[],
  now = new Date(),
): CashAdjustmentWindow {
  const date = businessTodayIso(now);
  const cie = findFullDayCieClose(dayCloses, collectorRef, date);
  if (!cie) {
    return {
      open: false,
      reason: `${PLANILLA_CASH_CHAIN_SECONDARY} aún no cierra hoy. El ajuste se hace después del cierre de ${PLANILLA_CASH_CHAIN_SECONDARY} y antes de medianoche.`,
    };
  }
  return { open: true, date, cie };
}

/** Lo que manda la pantalla; quién ajusta lo pone el aparato (sesión). */
export type CashAdjustmentRequest = {
  collectorRef: string;
  real: number;
  reason: string;
};

export type CashAdjustmentInput = CashAdjustmentRequest & {
  by: string;
  dayCloses: CollectorDayCloseRecord[];
  planillaCashCloses: PlanillaCashCloseRecord[];
  now?: Date;
};

export type CashAdjustmentResult =
  | {
      ok: true;
      record: CollectorDayCloseRecord;
      dayCloses: CollectorDayCloseRecord[];
      planillaCashCloses: PlanillaCashCloseRecord[];
    }
  | { ok: false; error: string };

export function commitCashAdjustment(input: CashAdjustmentInput): CashAdjustmentResult {
  const now = input.now ?? new Date();
  const adjustWindow = cashAdjustmentWindow(input.collectorRef, input.dayCloses, now);
  if (!adjustWindow.open) return { ok: false, error: adjustWindow.reason };

  const real = Number(input.real);
  if (!Number.isFinite(real) || real < 0 || !Number.isInteger(real)) {
    return { ok: false, error: "Escriba el saldo real contado (pesos, sin decimales)." };
  }
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 3) return { ok: false, error: "Escriba el motivo del ajuste." };
  const by = input.by.trim();
  if (!by) return { ok: false, error: "Falta quién hace el ajuste." };

  const cie = adjustWindow.cie;
  const calculated = pesos(cie.cashAdjustment?.calculated ?? cie.cashFloat);
  if (!cie.cashAdjustment && pesos(real) === calculated) {
    return { ok: false, error: "El saldo real es igual al del cierre: no hay nada que ajustar." };
  }

  const adjustment: CashAdjustment = {
    calculated,
    real: pesos(real),
    by,
    at: now.toISOString(),
    reason,
  };
  const record: CollectorDayCloseRecord = {
    ...cie,
    cashFloat: adjustment.real,
    cashExpected: calculated,
    cashDeclared: adjustment.real,
    cashVariance: pesos(adjustment.real - calculated),
    cashAdjustment: adjustment,
  };
  const dayCloses = input.dayCloses.map((row) => (row.ref === cie.ref ? record : row));

  const tRef = planillaCashCloseRef(input.collectorRef, adjustWindow.date, PLANILLA_CASH_CHAIN_SECONDARY);
  const planillaCashCloses = input.planillaCashCloses.some((row) => row.ref === tRef)
    ? input.planillaCashCloses.map((row) =>
        row.ref === tRef ? { ...row, closingCash: adjustment.real } : row,
      )
    : projectPceTFromDayCloses(input.planillaCashCloses, [record]);

  return { ok: true, record, dayCloses, planillaCashCloses };
}
