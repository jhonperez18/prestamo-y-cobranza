/**
 * Ajuste de saldo real en T — cadena completa en el aparato:
 * commit → caché local (+ -bak) → cola mirror → await nube.
 */
import type { CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { commitCashAdjustment, type CashAdjustmentRequest } from "@/lib/commit-cash-adjustment";
import {
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { money } from "@/lib/mock-data";
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

export async function saveCashAdjustment(
  input: SaveCashAdjustmentInput,
): Promise<SaveCashAdjustmentResult> {
  const result = commitCashAdjustment({
    ...input,
    dayCloses: readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
    planillaCashCloses: readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
  });
  if (!result.ok) return result;

  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, result.dayCloses);
  writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, result.planillaCashCloses);

  let cloud = false;
  try {
    cloud = await mirrorDayCloseNow(result.record);
    if (!cloud) await flushOpsMirrorQueues();
  } catch (error) {
    console.error("cash-adjustment-mirror", error);
  }

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
