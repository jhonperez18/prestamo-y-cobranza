import { money, type ActivityRow, type PaymentRow, type RouteRow, type StatusKind } from "@/lib/mock-data";

export type CollectorDailyLogRow = {
  ref: string;
  collectorRef: string;
  date: string;
  dateLabel: string;
  routeRef?: string;
  routeName?: string;
  zone?: string;
  visitsPlanned: number;
  visitsDone: number;
  visitsPartial: number;
  visitsPending: number;
  collected: number;
  paymentsCount: number;
  startedAt?: string;
  closedAt?: string;
  status: string;
  kind: StatusKind;
  summary: string;
};

const DEMO_YEAR = 2026;

export function parseActivityWhen(when: string) {
  const full = when.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*[·-]\s*(\d{1,2}:\d{2})/);
  if (full) {
    const [, day, month, year, time] = full;
    return {
      date: `${year}-${month}-${day}`,
      dateLabel: `${day}/${month}/${year}`,
      time,
    };
  }
  const short = when.match(/^(\d{2})\/(\d{2})\s*[·-]\s*(\d{1,2}:\d{2})/);
  if (short) {
    const [, day, month, time] = short;
    return {
      date: `${DEMO_YEAR}-${month}-${day}`,
      dateLabel: `${day}/${month}/${DEMO_YEAR}`,
      time,
    };
  }
  const legacy = when.match(/^(\d{2})\/(\d{2})\s*·?\s*(.*)$/);
  if (!legacy) return null;
  const [, day, month, rest] = legacy;
  const date = `${DEMO_YEAR}-${month}-${day}`;
  const dateLabel = `${day}/${month}/${DEMO_YEAR}`;
  const timeMatch = rest.trim().match(/(\d{1,2}:\d{2})/);
  const time = timeMatch?.[1] ?? (rest.trim() || undefined);
  return { date, dateLabel, time };
}

export function formatLogTime(value?: string) {
  if (!value) return "—";
  const match = value.match(/(\d{1,2}:\d{2})/);
  return match?.[1] ?? value;
}

export function formatActivityWhen(when: string) {
  const parsed = parseActivityWhen(when);
  if (!parsed) return when;
  if (parsed.time) return `${parsed.dateLabel} · ${parsed.time}`;
  return parsed.dateLabel;
}

export function activityWhenSortKey(when: string) {
  const parsed = parseActivityWhen(when);
  if (!parsed) return when;
  return `${parsed.date}T${parsed.time ?? "00:00"}`;
}

function visitCounts(stops: RouteRow["stops"]) {
  return {
    visitsPlanned: stops.length,
    visitsDone: stops.filter((stop) => stop.visitStatus === "cobrado").length,
    visitsPartial: stops.filter((stop) => stop.visitStatus === "parcial").length,
    visitsPending: stops.filter(
      (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
    ).length,
    visitsSkipped: stops.filter((stop) => stop.visitStatus === "omitido").length,
  };
}

function routeStatusKind(route?: RouteRow): { status: string; kind: StatusKind } {
  if (!route) return { status: "Sin ruta", kind: "draft" };
  if (route.status === "En curso") return { status: "En curso", kind: "pending" };
  if (route.status === "Cerrada") return { status: "Cerrada", kind: "paid" };
  return { status: route.status, kind: route.kind };
}

function buildSummary(row: Pick<
  CollectorDailyLogRow,
  "paymentsCount" | "collected" | "visitsDone" | "visitsPartial" | "visitsPending" | "status"
>) {
  const parts: string[] = [];
  if (row.paymentsCount > 0) {
    parts.push(`${row.paymentsCount} cobro${row.paymentsCount === 1 ? "" : "s"} · ${money(row.collected)}`);
  }
  if (row.visitsDone > 0) parts.push(`${row.visitsDone} visita${row.visitsDone === 1 ? "" : "s"} completada${row.visitsDone === 1 ? "" : "s"}`);
  if (row.visitsPartial > 0) parts.push(`${row.visitsPartial} parcial${row.visitsPartial === 1 ? "" : "es"}`);
  if (row.visitsPending > 0 && row.status === "En curso") {
    parts.push(`${row.visitsPending} pendiente${row.visitsPending === 1 ? "" : "s"}`);
  }
  if (row.status === "Cerrada" && !parts.length) parts.push("Jornada cerrada sin cobros");
  return parts.join(" · ") || "Sin movimientos";
}

export function dailyLogRef(collectorRef: string, date: string) {
  return `DL-${collectorRef}-${date}`;
}

export function buildCollectorDailyLogs(
  collectorRef: string,
  payments: PaymentRow[],
  activities: ActivityRow[],
  routes: RouteRow[],
): CollectorDailyLogRow[] {
  const byDate = new Map<string, CollectorDailyLogRow>();
  const collectorRoutes = routes.filter((row) => row.collectorRef === collectorRef);
  const collectorPay = payments.filter((row) => row.collectorRef === collectorRef);
  const collectorActs = activities.filter((row) => row.collectorRef === collectorRef);

  for (const payment of collectorPay) {
    const parsed =
      parseActivityWhen(payment.when) ??
      (payment.paidDate
        ? {
            date: payment.paidDate.slice(0, 10),
            dateLabel:
              payment.paidDate.length >= 10
                ? `${payment.paidDate.slice(8, 10)}/${payment.paidDate.slice(5, 7)}/${payment.paidDate.slice(0, 4)}`
                : payment.paidDate,
            time: payment.paidTime,
          }
        : null);
    if (!parsed) continue;
    const route = payment.routeRef
      ? routes.find((row) => row.ref === payment.routeRef)
      : collectorRoutes.find((row) => row.name === payment.client) ?? collectorRoutes[0];
    const existing =
      byDate.get(parsed.date) ??
      ({
        ref: dailyLogRef(collectorRef, parsed.date),
        collectorRef,
        date: parsed.date,
        dateLabel: parsed.dateLabel,
        routeRef: route?.ref,
        routeName: route?.name,
        zone: route?.zone,
        visitsPlanned: route?.stops.length ?? 0,
        visitsDone: 0,
        visitsPartial: 0,
        visitsPending: route?.stops.length ?? 0,
        collected: 0,
        paymentsCount: 0,
        status: "En curso",
        kind: "pending" as StatusKind,
        summary: "",
      } satisfies CollectorDailyLogRow);

    existing.collected += payment.amount;
    existing.paymentsCount += 1;
    if (parsed.time) existing.closedAt = parsed.time;
    if (!existing.startedAt) existing.startedAt = parsed.time;
    byDate.set(parsed.date, existing);
  }

  for (const act of collectorActs) {
    const parsed = parseActivityWhen(act.when);
    if (!parsed) continue;
    const route = collectorRoutes[0];
    const existing =
      byDate.get(parsed.date) ??
      ({
        ref: dailyLogRef(collectorRef, parsed.date),
        collectorRef,
        date: parsed.date,
        dateLabel: parsed.dateLabel,
        routeRef: route?.ref,
        routeName: route?.name,
        zone: route?.zone,
        visitsPlanned: route?.stops.length ?? 0,
        visitsDone: 0,
        visitsPartial: 0,
        visitsPending: route?.stops.length ?? 0,
        collected: 0,
        paymentsCount: 0,
        status: "En curso",
        kind: "pending" as StatusKind,
        summary: "",
      } satisfies CollectorDailyLogRow);

    if (/iniciada/i.test(act.label) && parsed.time) {
      existing.startedAt = existing.startedAt ?? parsed.time;
      existing.status = "En curso";
      existing.kind = "pending";
    }
    if (/cerrada|finalizada/i.test(`${act.label} ${act.detail}`)) {
      existing.closedAt = parsed.time ?? existing.closedAt;
      existing.status = "Cerrada";
      existing.kind = "paid";
    }
    byDate.set(parsed.date, existing);
  }

  const todayKey = [...byDate.keys()].sort().at(-1);
  const targetDate = todayKey ?? `${DEMO_YEAR}-08-27`;
  const [, month, day] = targetDate.split("-");
  const targetLabel = `${day}/${month}/${DEMO_YEAR}`;
  for (const route of collectorRoutes) {
    const counts = visitCounts(route.stops);
    const { status, kind } = routeStatusKind(route);
    const existing =
      byDate.get(targetDate) ??
      ({
        ref: dailyLogRef(collectorRef, targetDate),
        collectorRef,
        date: targetDate,
        dateLabel: targetLabel,
        routeRef: route.ref,
        routeName: route.name,
        zone: route.zone,
        ...counts,
        collected: 0,
        paymentsCount: 0,
        status,
        kind,
        summary: "",
      } satisfies CollectorDailyLogRow);

    existing.routeRef = route.ref;
    existing.routeName = route.name;
    existing.zone = route.zone;
    existing.visitsPlanned = counts.visitsPlanned;
    existing.visitsDone = counts.visitsDone;
    existing.visitsPartial = counts.visitsPartial;
    existing.visitsPending = counts.visitsPending;
    if (status === "Cerrada") {
      existing.status = status;
      existing.kind = kind;
    } else if (existing.status !== "Cerrada") {
      existing.status = status;
      existing.kind = kind;
    }
    byDate.set(targetDate, existing);
  }

  return [...byDate.values()]
    .map((row) => ({
      ...row,
      dateLabel:
        row.dateLabel ||
        row.date
          .split("-")
          .reverse()
          .join("/")
          .replace(/^(\d{2}\/\d{2})\/(\d{4})$/, "$1/$2"),
      summary: buildSummary(row),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeDailyLogs(
  stored: CollectorDailyLogRow[],
  computed: CollectorDailyLogRow[],
): CollectorDailyLogRow[] {
  const map = new Map<string, CollectorDailyLogRow>();
  for (const row of stored) map.set(row.ref, row);
  for (const row of computed) {
    const prev = map.get(row.ref);
    if (!prev) {
      map.set(row.ref, row);
      continue;
    }
    map.set(row.ref, {
      ...prev,
      ...row,
      collected: Math.max(prev.collected, row.collected),
      paymentsCount: Math.max(prev.paymentsCount, row.paymentsCount),
      visitsPlanned: row.visitsPlanned || prev.visitsPlanned,
      visitsDone: Math.max(prev.visitsDone, row.visitsDone),
      visitsPartial: Math.max(prev.visitsPartial, row.visitsPartial),
      visitsPending: row.visitsPending,
      startedAt: prev.startedAt ?? row.startedAt,
      closedAt: row.closedAt ?? prev.closedAt,
      status: row.status === "Cerrada" ? row.status : prev.status,
      kind: row.status === "Cerrada" ? row.kind : prev.kind,
      summary: buildSummary({
        paymentsCount: Math.max(prev.paymentsCount, row.paymentsCount),
        collected: Math.max(prev.collected, row.collected),
        visitsDone: Math.max(prev.visitsDone, row.visitsDone),
        visitsPartial: Math.max(prev.visitsPartial, row.visitsPartial),
        visitsPending: row.visitsPending,
        status: row.status === "Cerrada" ? row.status : prev.status,
      }),
    });
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function upsertDailyLogPayment(
  logs: CollectorDailyLogRow[],
  payment: PaymentRow,
  route?: RouteRow,
): CollectorDailyLogRow[] {
  const parsed = parseActivityWhen(payment.when);
  if (!parsed || !payment.collectorRef) return logs;

  const ref = dailyLogRef(payment.collectorRef, parsed.date);
  const counts = route ? visitCounts(route.stops) : null;
  const { status, kind } = routeStatusKind(route);
  const existing = logs.find((row) => row.ref === ref);

  const next: CollectorDailyLogRow = existing
    ? {
        ...existing,
        collected: existing.collected + payment.amount,
        paymentsCount: existing.paymentsCount + 1,
        closedAt: parsed.time ?? existing.closedAt,
        routeRef: route?.ref ?? existing.routeRef,
        routeName: route?.name ?? existing.routeName,
        zone: route?.zone ?? existing.zone,
        visitsPlanned: counts?.visitsPlanned ?? existing.visitsPlanned,
        visitsDone: counts?.visitsDone ?? existing.visitsDone,
        visitsPartial: counts?.visitsPartial ?? existing.visitsPartial,
        visitsPending: counts?.visitsPending ?? existing.visitsPending,
        status: existing.status === "Cerrada" ? existing.status : status,
        kind: existing.status === "Cerrada" ? existing.kind : kind,
      }
    : {
        ref,
        collectorRef: payment.collectorRef,
        date: parsed.date,
        dateLabel: parsed.dateLabel,
        routeRef: route?.ref,
        routeName: route?.name,
        zone: route?.zone,
        visitsPlanned: counts?.visitsPlanned ?? 0,
        visitsDone: counts?.visitsDone ?? 0,
        visitsPartial: counts?.visitsPartial ?? 0,
        visitsPending: counts?.visitsPending ?? 0,
        collected: payment.amount,
        paymentsCount: 1,
        startedAt: parsed.time,
        closedAt: parsed.time,
        status,
        kind,
        summary: "",
      };

  next.summary = buildSummary(next);
  const rest = logs.filter((row) => row.ref !== ref);
  return [next, ...rest].sort((a, b) => b.date.localeCompare(a.date));
}

export const COLLECTOR_DAILY_LOGS_SEED: CollectorDailyLogRow[] = [
  {
    ref: "DL-COB-0-2026-08-26",
    collectorRef: "COB-0",
    date: "2026-08-26",
    dateLabel: "26/08/2026",
    routeRef: "RUT-0",
    routeName: "Norte",
    zone: "Norte",
    visitsPlanned: 3,
    visitsDone: 2,
    visitsPartial: 1,
    visitsPending: 0,
    collected: 22000,
    paymentsCount: 2,
    startedAt: "07:55",
    closedAt: "17:20",
    status: "Cerrada",
    kind: "paid",
    summary: "2 cobros · $ 22.000 · 2 visitas completadas · 1 parcial",
  },
  {
    ref: "DL-COB-1-2026-08-26",
    collectorRef: "COB-1",
    date: "2026-08-26",
    dateLabel: "26/08/2026",
    routeRef: "RUT-1",
    routeName: "Sur",
    zone: "Sur",
    visitsPlanned: 2,
    visitsDone: 1,
    visitsPartial: 1,
    visitsPending: 0,
    collected: 15000,
    paymentsCount: 1,
    startedAt: "08:00",
    closedAt: "16:02",
    status: "Cerrada",
    kind: "paid",
    summary: "1 cobro · $ 15.000 · 1 visita completada · 1 parcial",
  },
  {
    ref: "DL-COB-2-2026-08-27",
    collectorRef: "COB-2",
    date: "2026-08-27",
    dateLabel: "27/08/2026",
    routeRef: "RUT-2",
    routeName: "Centro",
    zone: "Centro",
    visitsPlanned: 3,
    visitsDone: 3,
    visitsPartial: 0,
    visitsPending: 0,
    collected: 30000,
    paymentsCount: 3,
    startedAt: "07:50",
    closedAt: "12:30",
    status: "Cerrada",
    kind: "paid",
    summary: "3 cobros · $ 30.000 · 3 visitas completadas",
  },
];

export function dailyLogsForCollector(
  collectorRef: string,
  stored: CollectorDailyLogRow[],
  payments: PaymentRow[],
  activities: ActivityRow[],
  routes: RouteRow[],
) {
  const scoped = stored.filter((row) => row.collectorRef === collectorRef);
  const computed = buildCollectorDailyLogs(collectorRef, payments, activities, routes);
  return mergeDailyLogs(scoped, computed);
}

export function paymentsForDailyLog(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
) {
  return payments.filter((row) => {
    if (row.collectorRef !== collectorRef) return false;
    if (row.paidDate && row.paidDate.slice(0, 10) === date) return true;
    const parsed = parseActivityWhen(row.when);
    return parsed?.date === date;
  });
}
