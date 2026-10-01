import {
  buildDayExpenseDraft,
  upsertDayExpenseDraft,
  type CollectorDayExpenseDraft,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { DEMO_COLLECTOR_DAY_EXPENSES_KEY, writeDemoJson } from "@/lib/demo-persist";
import { money } from "@/lib/mock-data";
import { mirrorDayExpenseNow } from "@/lib/supabase/ops-mirror";

export type DayExpenseCommitInput = {
  collectorRef: string;
  collectorName: string;
  date: string;
  routeRef: string;
  expenses: RouteExpenseLine[];
};

export type DayExpenseCommit = {
  draft: CollectorDayExpenseDraft;
  drafts: CollectorDayExpenseDraft[];
  /** Quedó en el aparato (localStorage). */
  savedLocal: boolean;
  /** Se resuelve cuando la nube confirma (true) o el envío falla y queda en cola (false). */
  inCloud: Promise<boolean>;
};

/**
 * Único camino para guardar los gastos del día de un cobrador:
 * borrador GAS- → caché local → cola + subida a Supabase (esperable).
 */
export function commitDayExpenseDraft(
  drafts: CollectorDayExpenseDraft[],
  input: DayExpenseCommitInput,
): DayExpenseCommit {
  const draft = buildDayExpenseDraft(input);
  const next = upsertDayExpenseDraft(drafts, draft);
  const savedLocal = writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next);
  return { draft, drafts: next, savedLocal, inCloud: mirrorDayExpenseNow(draft) };
}

/** Aviso honesto: dice si el gasto ya está en la nube o solo en este aparato. */
export function dayExpenseSavedMessage(
  draft: CollectorDayExpenseDraft,
  savedLocal: boolean,
  inCloud: boolean,
): string {
  if (inCloud) {
    return draft.expensesTotal > 0
      ? `Gastos guardados · ${money(draft.expensesTotal)} · en la nube`
      : "Gastos limpiados.";
  }
  if (savedLocal) {
    return `Gastos guardados en este aparato · ${money(draft.expensesTotal)} · sin nube aún (se sube solo).`;
  }
  return "No se guardaron los gastos: el aparato no tiene espacio y no hubo conexión. Intenta de nuevo.";
}
