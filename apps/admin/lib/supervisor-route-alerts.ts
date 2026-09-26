/**
 * Alertas de cobros nuevos para el supervisor (por planilla/ruta).
 * Contador = PG- del día de esa ruta aún no revisados; al abrir la ruta se marcan vistos.
 * En Nequi/Banco el contador se filtra por medio de pago.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import { paymentsForCollector } from "@/lib/mock-data";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
} from "@/lib/mock-data";
import { normalizePaymentMethod, type PaymentMethod } from "@/lib/payment-method";
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

/** Clave estable: cobrador + ruta (no mezclar planillas del mismo cobrador). */
export function supervisorRouteSeenKey(collectorRef: string, routeName: string) {
  return `${collectorRef.trim()}::${routeName.trim().toUpperCase()}`;
}

function clientRefsOnRoute(clients: ClientRow[], routeName: string) {
  return new Set(
    clients
      .filter((row) => sameRoute(row.route, routeName))
      .map((row) => row.ref),
  );
}

function paymentBelongsToRoute(
  pay: PaymentRow,
  routeRef: string,
  routeName: string,
  loanByRef: Map<string, LoanRow>,
  clientRefs: Set<string>,
) {
  const payRoute = (pay.routeRef || "").trim();
  if (payRoute) {
    if (payRoute === routeRef.trim()) return true;
    if (sameRoute(payRoute, routeName)) return true;
  }
  const loan = pay.loanRef ? loanByRef.get(pay.loanRef) : undefined;
  const clientRef = loan?.clientRef?.trim();
  return Boolean(clientRef && clientRefs.has(clientRef));
}

/** Refs de cobros del cobrador en esa ruta/día (solo montos > 0). */
export function paymentRefsForCollectorRouteDay(
  collectorRef: string,
  routeRef: string,
  routeName: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  method?: PaymentMethod,
): string[] {
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const clientRefs = clientRefsOnRoute(clients, routeName);
  const loanByRef = new Map(loans.map((row) => [row.ref, row]));
  return paymentsForCollector(collectorRef, collectors, payments)
    .filter((row) => {
      if ((Number(row.amount) || 0) <= 0) return false;
      if ((normalizeHistoryDate(row.paidDate || "") || "") !== day) return false;
      if (method && normalizePaymentMethod(row.method) !== method) return false;
      return paymentBelongsToRoute(row, routeRef, routeName, loanByRef, clientRefs);
    })
    .map((row) => row.ref)
    .filter(Boolean);
}

/**
 * Si cambió el día, limpia “vistos” de esa planilla.
 * Sin entrada del día = aún no revisó la ruta → todos los PG- de hoy de esa ruta cuentan.
 */
export function ensureRouteDayBaseline(
  collectorRef: string,
  routeName: string,
  dayIso: string,
) {
  if (typeof window === "undefined") return;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const key = supervisorRouteSeenKey(collectorRef, routeName);
  if (!collectorRef.trim() || !routeName.trim()) return;
  const map = readSeen();
  const current = map[key];
  if (current?.day === day) return;
  map[key] = { day, refs: [] };
  writeSeen(map);
}

export function unreadPaymentCountForRoute(
  collectorRef: string,
  routeRef: string,
  routeName: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  method?: PaymentMethod,
): number {
  if (typeof window === "undefined") return 0;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  if (!collectorRef.trim() || !routeName.trim()) return 0;
  ensureRouteDayBaseline(collectorRef, routeName, day);
  const key = supervisorRouteSeenKey(collectorRef, routeName);
  const seen = new Set(readSeen()[key]?.refs ?? []);
  return paymentRefsForCollectorRouteDay(
    collectorRef,
    routeRef,
    routeName,
    day,
    collectors,
    payments,
    loans,
    clients,
    method,
  ).filter((ref) => !seen.has(ref)).length;
}

/**
 * Al entrar a la planilla: marca vistos.
 * Sin `method` → todos los PG- de la ruta (INICIO / caja / ruta).
 * Con `method` (nequi|banco) → solo esos medios; el resto sigue pendiente en INICIO.
 */
export function markRouteDaySeen(
  collectorRef: string,
  routeRef: string,
  routeName: string,
  dayIso: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  method?: PaymentMethod,
) {
  if (typeof window === "undefined") return;
  const day = normalizeHistoryDate(dayIso) || dayIso;
  const key = supervisorRouteSeenKey(collectorRef, routeName);
  if (!collectorRef.trim() || !routeName.trim()) return;
  const map = readSeen();
  const scoped = paymentRefsForCollectorRouteDay(
    collectorRef,
    routeRef,
    routeName,
    day,
    collectors,
    payments,
    loans,
    clients,
    method,
  );
  if (method) {
    const prev = map[key]?.day === day ? map[key].refs : [];
    map[key] = { day, refs: Array.from(new Set([...prev, ...scoped])) };
  } else {
    map[key] = { day, refs: scoped };
  }
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
