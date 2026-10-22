import { BUSINESS_TIME_ZONE } from "@/lib/business-timezone";
import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow } from "@/lib/mock-data";

/**
 * Hora del cierre de una ruta. Sale de `dayClosedAt`, la marca que se escribe
 * una sola vez al sellar la hoja. Supervisor y cobrador leen esta misma función.
 * Devuelve «21:01» (24 h, Bogotá) o vacío si no hay sello.
 */
export function formatCloseClock(raw: string | undefined | null): string {
  const text = String(raw || "")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/\d{4}-\d{2}-\d{2}/.test(text)) {
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return "";
    return bogotaClock(new Date(ms));
  }
  const ampm = text.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour > 12 || minute > 59) return "";
    const ap = ampm[3].toLowerCase();
    if (ap === "p" && hour < 12) hour += 12;
    if (ap === "a" && hour === 12) hour = 0;
    return padClock(hour, minute);
  }
  const plain = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!plain) return "";
  const hour = Number(plain[1]);
  const minute = Number(plain[2]);
  if (hour > 23 || minute > 59) return "";
  return padClock(hour, minute);
}

export function closeClockFromStamps(stamps: Array<string | undefined | null>): string {
  let clock = "";
  let mins = -1;
  for (const raw of stamps) {
    const next = formatCloseClock(raw);
    if (!next) continue;
    const n = clockMinutes(next);
    if (n >= mins) {
      mins = n;
      clock = next;
    }
  }
  return clock;
}

/** Hora de cierre por día, de una ruta y un cobrador. */
export function routeCloseClocks(
  assignments: Array<
    Pick<
      DailyCollectionAssignment,
      "collectorRef" | "dispatchDate" | "dayClosedAt" | "clientRef" | "clientRoute"
    >
  >,
  clients: ClientRow[],
  collectorRef: string,
  routeName: string,
): Map<string, string> {
  const ref = collectorRef.trim();
  const route = routeName.trim();
  const best = new Map<string, { clock: string; mins: number }>();
  if (!ref || !route) return new Map();
  for (const row of assignments) {
    if (row.collectorRef !== ref) continue;
    const date = normalizeHistoryDate(row.dispatchDate) || String(row.dispatchDate || "").trim();
    if (!date) continue;
    if (!sameRoute(assignmentRouteName(row, clients), route)) continue;
    const clock = formatCloseClock(row.dayClosedAt);
    if (!clock) continue;
    const mins = clockMinutes(clock);
    const prev = best.get(date);
    if (!prev || mins >= prev.mins) best.set(date, { clock, mins });
  }
  const out = new Map<string, string>();
  for (const [date, slot] of best) out.set(date, slot.clock);
  return out;
}

function padClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clockMinutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function bogotaClock(date: Date) {
  const bag: Record<string, string> = {};
  for (const part of bogotaFormatter().formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  return padClock(hour, minute);
}

let formatter: Intl.DateTimeFormat | null = null;

function bogotaFormatter() {
  formatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return formatter;
}
