/**
 * Ajuste de saldo real (T, o planilla A/N) — cadena completa en el aparato:
 * commit → caché local (+ -bak) → cola mirror → await nube.
 */
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { commitCashAdjustment, type CashAdjustmentRequest } from "@/lib/commit-cash-adjustment";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  commitDigitalPoolAdjustment,
  DIGITAL_POOL_LABEL,
  digitalPoolAdjustWindow,
  digitalPoolBalances,
  type DigitalPool,
} from "@/lib/digital-pools";
import {
  commitRouteCashAdjustment,
  independentRouteDay,
  routeCashAdjustmentWindow,
} from "@/lib/independent-route-cash";
import {
  money,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import type { PlanillaCashCloseRecord } from "@/lib/planilla-cash-chain";
import { flushOpsMirrorQueues, mirrorDayCloseNow } from "@/lib/supabase/ops-mirror";

export type SaveCashAdjustmentInput = CashAdjustmentRequest & { by: string };

export type SaveCashAdjustmentResult =
  | {
      ok: true;
      dayCloses: CollectorDayCloseRecord[];
      planillaCashCloses: PlanillaCashCloseRecord[];
      /** La nube confirmó la escritura (otros aparatos ya lo ven). */
      cloud: boolean;
      message: string;
    }
  | { ok: false; error: string };

async function mirrorAdjustedClose(record: CollectorDayCloseRecord) {
  try {
    const cloud = await mirrorDayCloseNow(record);
    if (!cloud) await flushOpsMirrorQueues();
    return cloud;
  } catch (error) {
    console.error("cash-adjustment-mirror", error);
    return false;
  }
}

/** Saldo del día de la planilla A/N según el dueño (`independentRouteDay`), sin el ajuste. */
function calculatedRouteSaldo(
  collectorRef: string,
  route: string,
  date: string,
  dayCloses: CollectorDayCloseRecord[],
  planillaCashCloses: PlanillaCashCloseRecord[],
) {
  return independentRouteDay(
    {
      collectorRef,
      date,
      payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
      loans: readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []),
      clients: readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []),
      collectors: readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []),
      assignments: readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []),
      dayCloses,
      dayExpenseDrafts: readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
      planillaCashCloses,
      monthCloses: readDemoJson<CollectorMonthCloseRecord[]>(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []),
    },
    route,
  ).closing;
}

async function saveRouteCashAdjustment(
  input: SaveCashAdjustmentInput & { route: string },
): Promise<SaveCashAdjustmentResult> {
  const dayCloses = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
  const planillaCashCloses = readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []);
  const adjustWindow = routeCashAdjustmentWindow(input.collectorRef, input.route, dayCloses);
  if (!adjustWindow.open) return { ok: false, error: adjustWindow.reason };

  const result = commitRouteCashAdjustment({
    collectorRef: input.collectorRef,
    route: input.route,
    real: input.real,
    reason: input.reason,
    by: input.by,
    calculated: calculatedRouteSaldo(
      input.collectorRef,
      input.route,
      adjustWindow.date,
      dayCloses,
      planillaCashCloses,
    ),
    dayCloses,
  });
  if (!result.ok) return result;

  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, result.dayCloses);
  const cloud = await mirrorAdjustedClose(result.record);
  const real = money(input.real);
  return {
    ok: true,
    dayCloses: result.dayCloses,
    planillaCashCloses,
    cloud,
    message: cloud
      ? `Saldo de ${input.route} ajustado a ${real}. Es el Inicial de ${input.route} de mañana.`
      : `Saldo de ${input.route} ajustado a ${real} en este aparato. La nube no lo confirmó: queda en cola y se reintenta.`,
  };
}

export type SaveDigitalPoolAdjustmentInput = {
  pool: DigitalPool;
  real: number;
  reason: string;
  by: string;
  /** Cobradores de las rutas del supervisor (todos deben haber cerrado hoy). */
  collectors: Array<{ ref: string; name?: string }>;
};

export type DigitalPoolAdjustRequest = Omit<SaveDigitalPoolAdjustmentInput, "by">;

export type SaveDigitalPoolAdjustmentResult =
  | { ok: true; dayCloses: CollectorDayCloseRecord[]; cloud: boolean; message: string }
  | { ok: false; error: string };

/** Cuadre del total acumulado de BANCO / NEQUI: commit → local → await nube (cada CIE- de hoy). */
export async function saveDigitalPoolAdjustment(
  input: SaveDigitalPoolAdjustmentInput,
): Promise<SaveDigitalPoolAdjustmentResult> {
  const dayCloses = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
  const adjustWindow = digitalPoolAdjustWindow(input.collectors, dayCloses);
  if (!adjustWindow.open) return { ok: false, error: adjustWindow.reason };

  const calculated = digitalPoolBalances(
    {
      payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
      loans: readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []),
      clients: readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []),
      collectors: readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []),
      collectorRefs: input.collectors.map((row) => row.ref),
      dayCloses,
    },
    adjustWindow.date,
  )[input.pool];

  const result = commitDigitalPoolAdjustment({
    pool: input.pool,
    real: input.real,
    reason: input.reason,
    by: input.by,
    calculated,
    collectors: input.collectors,
    dayCloses,
  });
  if (!result.ok) return result;

  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, result.dayCloses);
  const mirrored = await Promise.all(result.records.map((record) => mirrorAdjustedClose(record)));
  const cloud = mirrored.every(Boolean);
  const label = DIGITAL_POOL_LABEL[input.pool];
  const real = money(input.real);
  return {
    ok: true,
    dayCloses: result.dayCloses,
    cloud,
    message: cloud
      ? `Total acumulado ${label} cuadrado en ${real}. Desde mañana suma sobre ese saldo.`
      : `Total acumulado ${label} cuadrado en ${real} en este aparato. La nube no lo confirmó: queda en cola y se reintenta.`,
  };
}

export async function saveCashAdjustment(
  input: SaveCashAdjustmentInput,
): Promise<SaveCashAdjustmentResult> {
  if (input.route) return saveRouteCashAdjustment({ ...input, route: input.route });

  const result = commitCashAdjustment({
    ...input,
    dayCloses: readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
    planillaCashCloses: readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
  });
  if (!result.ok) return result;

  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, result.dayCloses);
  writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, result.planillaCashCloses);

  const cloud = await mirrorAdjustedClose(result.record);
  const real = money(result.record.cashFloat);
  return {
    ok: true,
    dayCloses: result.dayCloses,
    planillaCashCloses: result.planillaCashCloses,
    cloud,
    message: cloud
      ? `Saldo ajustado a ${real}. Es el Inicial de M de mañana.`
      : `Saldo ajustado a ${real} en este aparato. La nube no lo confirmó: queda en cola y se reintenta.`,
  };
}
