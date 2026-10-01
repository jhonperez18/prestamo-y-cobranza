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
import { paymentMethodForRoute, type PaymentMethod } from "@/lib/payment-method";
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
      if (method && paymentMethodForRoute(row.method, routeName) !== method) return false;
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

const CHIME_FREQUENCY_HZ = 1800;
const CHIME_VOLUME = 0.35;
const CHIME_BEEP_SECONDS = 0.12;
const CHIME_GAP_SECONDS = 0.08;

let chimeContext: AudioContext | null = null;

function chimeAudioContext(): AudioContext | null {
  if (chimeContext) return chimeContext;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  chimeContext = new Ctx();
  return chimeContext;
}

/** El celular solo deja sonar audio creado tras un toque: se desbloquea con el primero. */
function unlockChimeAudio() {
  try {
    const ctx = chimeAudioContext();
    if (ctx?.state === "suspended") void ctx.resume();
  } catch (err) {
    console.error("[alerta supervisor] audio", err);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockChimeAudio, { once: true, passive: true });
  window.addEventListener("keydown", unlockChimeAudio, { once: true });
}

function scheduleBeep(ctx: AudioContext, start: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = CHIME_FREQUENCY_HZ;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(CHIME_VOLUME, start + 0.01);
  gain.gain.setValueAtTime(CHIME_VOLUME, start + CHIME_BEEP_SECONDS - 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + CHIME_BEEP_SECONDS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + CHIME_BEEP_SECONDS + 0.01);
}

/** Pitido doble («pi-pi») cuando sube el contador de cobros sin ver. */
export function playSupervisorPaymentChime() {
  if (typeof window === "undefined") return;
  try {
    const ctx = chimeAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.02;
    scheduleBeep(ctx, t);
    scheduleBeep(ctx, t + CHIME_BEEP_SECONDS + CHIME_GAP_SECONDS);
  } catch (err) {
    console.error("[alerta supervisor] pitido", err);
  }
}
