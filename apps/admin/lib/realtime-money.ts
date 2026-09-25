/**
 * Canal Realtime del dinero.
 * En Supabase los gastos son `day_expenses` y los cierres son `day_closes`.
 * La planilla es `daily_assignments` (N/P, cobro, dayClosedAt).
 * No existe una tabla `expenses` ni `closures`: suscribir esos nombres tumba el canal.
 */
import { ADMIN_ROLE_REF, COLLECTOR_ROLE_REF, SUPERVISOR_ROLE_REF } from "@/lib/mock-data";

export const REALTIME_MONEY_TABLES = [
  "payments",
  "day_expenses",
  "day_closes",
  "daily_assignments",
] as const;
export const REALTIME_MONEY_EVENTS = ["INSERT", "UPDATE", "DELETE"] as const;

type MoneyChannel = {
  on(
    event: "postgres_changes",
    filter: {
      event: "INSERT" | "UPDATE" | "DELETE";
      schema: "public";
      table: string;
      filter?: string;
    },
    callback: () => void,
  ): MoneyChannel;
};

/**
 * Admin y supervisor no llevan filtro: el canal sigue global aunque la pantalla
 * simule a un cobrador. Solo el login cobrador acota por `collector_ref`.
 */
export function moneyRealtimeFilter(roleRef: string | undefined, collectorRef: string | undefined) {
  if (roleRef === ADMIN_ROLE_REF || roleRef === SUPERVISOR_ROLE_REF) return undefined;
  const ref = collectorRef?.trim();
  if (roleRef === COLLECTOR_ROLE_REF && ref) return `collector_ref=eq.${ref}`;
  return undefined;
}

export function bindMoneyRealtime<T extends MoneyChannel>(
  channel: T,
  onEvent: () => void,
  filter?: string,
): T {
  for (const table of REALTIME_MONEY_TABLES) {
    for (const event of REALTIME_MONEY_EVENTS) {
      channel.on(
        "postgres_changes",
        filter
          ? { event, schema: "public", table, filter }
          : { event, schema: "public", table },
        onEvent,
      );
    }
  }
  return channel;
}
