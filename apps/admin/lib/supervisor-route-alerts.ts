/**
 * Alertas de cobros nuevos para el supervisor (por cobrador/ruta).
 * Contador = PG- del día aún no revisados; al abrir la ruta se marcan vistos.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { paymentsForCollector } from "@/lib/mock-data";
import type { CollectorRow, PaymentRow } from "@/lib/mock-data";
import { readDemoJson, writeDemoJson } from "@/lib/demo-persist";

export const SUPERVISOR_ROUTE_SEEN_KEY = "nexo-demo-supervisor-route-seen";

type SeenEntry = { day: string; refs: string[] };
type SeenMap = Record<string, SeenEntry>;

function readSeen(): SeenMap {
  return readDemoJson<SeenMap>(SUPERVISOR_ROUTE_SEEN_KEY, {});
}

function writeSeen(map: SeenMap) {
  writeDemoJson(SUPERVISOR_ROUTE_SEEN_KEY, map);
}

/** Refs de cobros del cobrador en el día (solo montos > 0). */
export function paymentRefsForCollectorDay(
  collectorRef: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
): string[] {
  const day = normalizeHistoryDate(dayIso) || dayIso;
  return paymentsForCollector(collectorRef, collectors, payments)
    .filter(
      (row) =>
        (Number(row.amount) || 0) > 0 &&
        (normalizeHistoryDate(row.paidDate || "") || "") === day,
    )
    .map((row) => row.ref)
    .filter(Boolean);
}

/**
 * Si cambió el día, limpia “vistos” de ese cobrador.
 * Sin entrada del día = aún no revisó la ruta → todos los PG- de hoy cuentan.
 */
export function ensureCollectorDayBaseline(collectorRef: string, dayIso: string) {
  if (typeof window === "undefined") return;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const key = collectorRef.trim();
  if (!key) return;
  const map = readSeen();
  const current = map[key];
  if (current?.day === day) return;
  map[key] = { day, refs: [] };
  writeSeen(map);
}

export function unreadPaymentCountForCollector(
  collectorRef: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
): number {
  if (typeof window === "undefined") return 0;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const key = collectorRef.trim();
  if (!key) return 0;
  ensureCollectorDayBaseline(key, day);
  const seen = new Set(readSeen()[key]?.refs ?? []);
  return paymentRefsForCollectorDay(key, day, collectors, payments).filter(
    (ref) => !seen.has(ref),
  ).length;
}

/** Al entrar a la ruta: contador → 0. */
export function markCollectorDaySeen(
  collectorRef: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
) {
  if (typeof window === "undefined") return;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const key = collectorRef.trim();
  if (!key) return;
  const map = readSeen();
  map[key] = {
    day,
    refs: paymentRefsForCollectorDay(key, day, collectors, payments),
  };
  writeSeen(map);
}

/** Pitido corto (opcional) cuando sube el contador. */
export function playSupervisorPaymentChime() {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    osc.start(t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.stop(t + 0.2);
    window.setTimeout(() => void ctx.close(), 280);
  } catch {
    /* sin audio / política del navegador */
  }
}
