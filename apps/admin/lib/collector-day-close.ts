import {
  addManualExpense,
  paymentRefForMovement,
  periodFromIso,
  type BankExpenseCategory,
  type BankMovement,
} from "@/lib/bank";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import { displayToIso } from "@/lib/loan-preview";
import { money, type CollectorRow, type PaymentRow, paymentsForCollector } from "@/lib/mock-data";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";

/** Gastos típicos de ruta del cobrador (cuadre de cierre). */
export const ROUTE_EXPENSE_ITEMS = [
  { id: "almuerzo", label: "Almuerzo", category: "almuerzo" as BankExpenseCategory },
  { id: "gasolina", label: "Gasolina", category: "gasolina" as BankExpenseCategory },
  { id: "prestamo", label: "Préstamo", category: "prestamo_ruta" as BankExpenseCategory },
  { id: "otros", label: "Otros", category: "otro" as BankExpenseCategory },
  { id: "nomina", label: "Nómina", category: "nomina" as BankExpenseCategory },
  { id: "transporte", label: "Transporte", category: "transporte" as BankExpenseCategory },
  { id: "consignacion", label: "Consignación", category: "consignacion" as BankExpenseCategory },
] as const;

export type RouteExpenseId = (typeof ROUTE_EXPENSE_ITEMS)[number]["id"];

export type RouteExpenseLine = {
  id: RouteExpenseId;
  label: string;
  amount: number;
  category: BankExpenseCategory;
};

export type CollectorDayCloseDraft = {
  collectorRef: string;
  collectorName: string;
  date: string;
  routeRef: string;
  collected: number;
  expenses: RouteExpenseLine[];
};

export type CollectorDayCloseRecord = CollectorDayCloseDraft & {
  ref: string;
  closedAt: string;
  expensesTotal: number;
  /** Recaudo − gastos: queda en caja menor hasta consignar. */
  cashFloat: number;
  movementRefs: string[];
};

/** Gastos de ruta guardados durante el día (antes de cerrar). */
export type CollectorDayExpenseDraft = {
  ref: string;
  collectorRef: string;
  collectorName: string;
  date: string;
  routeRef: string;
  expenses: RouteExpenseLine[];
  expensesTotal: number;
  updatedAt: string;
};

export type CollectorDayHistoryRow = {
  date: string;
  dateLabel: string;
  cobro: number;
  gasto: number;
  /** Saldo en mano al cierre del día (acumulado hasta consignar). */
  saldo: number;
};

/** Cierre de mes: revisión de caja y arrastre de saldo al mes siguiente. */
export type CollectorMonthCloseRecord = {
  ref: string;
  collectorRef: string;
  collectorName: string;
  /** Periodo YYYY-MM que se cierra. */
  period: string;
  /** Saldo en mano al guardar el mes (arrastre). */
  closingSaldo: number;
  closedAt: string;
};

/** Unifica fechas de historial: ISO `YYYY-MM-DD` (acepta también `DD/MM/YYYY`). */
export function normalizeHistoryDate(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const fromDisplay = displayToIso(s);
  return fromDisplay || s;
}

export function periodFromDateIso(iso: string) {
  const norm = normalizeHistoryDate(iso);
  return norm.slice(0, 7);
}

export function dayNumberFromIso(iso: string) {
  const norm = normalizeHistoryDate(iso);
  const day = Number(norm.slice(8, 10));
  return Number.isFinite(day) && day > 0 ? String(day) : iso;
}

export function isLastCalendarDayOfMonth(iso: string) {
  const norm = normalizeHistoryDate(iso);
  const [y, m, d] = norm.split("-").map(Number);
  if (!y || !m || !d) return false;
  const last = new Date(y, m, 0).getDate();
  return d === last;
}

export function previousPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthCloseRef(collectorRef: string, period: string) {
  return `MES-${collectorRef}-${period}`;
}

export function findMonthClose(
  closes: CollectorMonthCloseRecord[],
  collectorRef: string,
  period: string,
) {
  const ref = monthCloseRef(collectorRef, period);
  return closes.find((row) => row.ref === ref) ?? null;
}

export function openingSaldoForPeriod(
  collectorRef: string,
  period: string,
  monthCloses: CollectorMonthCloseRecord[],
) {
  const prev = previousPeriod(period);
  return findMonthClose(monthCloses, collectorRef, prev)?.closingSaldo ?? 0;
}

/**
 * Día 1 (y el mes nuevo): no cobrar hasta guardar/revisar el mes anterior.
 * Si no hay mes anterior cerrado y el día es 01, bloquea.
 */
export function monthReviewBlock(input: {
  collectorRef: string;
  date: string;
  monthCloses: CollectorMonthCloseRecord[];
  /** Si el mes anterior tuvo actividad de caja, exige cierre. */
  priorMonthHadActivity?: boolean;
}) {
  const period = periodFromDateIso(input.date);
  const day = Number(input.date.slice(8, 10));
  if (day !== 1) return null;
  const prev = previousPeriod(period);
  if (findMonthClose(input.monthCloses, input.collectorRef, prev)) return null;
  if (input.priorMonthHadActivity === false) return null;
  return {
    previousPeriod: prev,
    message:
      "Día 1: revisa que no haya desfalco, guarda el mes anterior y arrastra el saldo antes de cobrar.",
  };
}

export function buildMonthCloseRecord(input: {
  collectorRef: string;
  collectorName: string;
  period: string;
  closingSaldo: number;
}): CollectorMonthCloseRecord {
  return {
    ref: monthCloseRef(input.collectorRef, input.period),
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    period: input.period,
    closingSaldo: input.closingSaldo,
    closedAt: new Date().toISOString(),
  };
}

/** Etiqueta de fecha en historial: solo día si es el mes en curso. */
export function historyDayLabel(iso: string, viewPeriod: string) {
  const norm = normalizeHistoryDate(iso);
  const period = periodFromDateIso(norm);
  const day = dayNumberFromIso(norm);
  if (period === viewPeriod) return day;
  const [, month] = norm.split("-");
  return `${day}/${month}`;
}

export function emptyRouteExpenseAmounts(): Record<RouteExpenseId, string> {
  return {
    almuerzo: "",
    gasolina: "",
    prestamo: "",
    otros: "",
    nomina: "",
    transporte: "",
    consignacion: "",
  };
}

export function parseExpenseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function formatExpenseAmountInput(value: number | string) {
  const digits =
    typeof value === "number"
      ? Math.trunc(Math.abs(value)).toString()
      : value.replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function buildExpenseLines(amounts: Record<RouteExpenseId, string>): RouteExpenseLine[] {
  return ROUTE_EXPENSE_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    amount: parseExpenseAmount(amounts[item.id] ?? ""),
  })).filter((line) => line.amount > 0);
}

export function sumExpenseLines(lines: RouteExpenseLine[]) {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

export function cashFloatAfterExpenses(collected: number, expensesTotal: number) {
  return collected - expensesTotal;
}

export function dayCloseRef(collectorRef: string, date: string) {
  return `CIE-${collectorRef}-${date}`;
}

export function dayExpenseDraftRef(collectorRef: string, date: string) {
  return `GAS-${collectorRef}-${date}`;
}

/** Clave estable por línea de gasto → movimiento bancario. */
export function dayExpenseLineMovementRef(
  collectorRef: string,
  date: string,
  expenseId: string,
) {
  return `GASL-${collectorRef}-${date}-${expenseId}`;
}

export function buildDayExpenseDraft(input: {
  collectorRef: string;
  collectorName: string;
  date: string;
  routeRef: string;
  expenses: RouteExpenseLine[];
}): CollectorDayExpenseDraft {
  const lines = input.expenses.filter((row) => row.amount > 0);
  return {
    ref: dayExpenseDraftRef(input.collectorRef, input.date),
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    date: input.date,
    routeRef: input.routeRef,
    expenses: lines,
    expensesTotal: sumExpenseLines(lines),
    updatedAt: new Date().toISOString(),
  };
}

export function findDayExpenseDraft(
  drafts: CollectorDayExpenseDraft[],
  collectorRef: string,
  date: string,
) {
  const ref = dayExpenseDraftRef(collectorRef, date);
  return drafts.find((row) => row.ref === ref) ?? null;
}

/** Gastos del día: cierre definitivo si existe; si no, borrador guardado. */
export function expensesForCollectorDay(
  collectorRef: string,
  date: string,
  closes: CollectorDayCloseRecord[],
  drafts: CollectorDayExpenseDraft[],
): RouteExpenseLine[] {
  const closeRef = dayCloseRef(collectorRef, date);
  const closed = closes.find((row) => row.ref === closeRef);
  if (closed) return closed.expenses.filter((row) => row.amount > 0);
  const draft = findDayExpenseDraft(drafts, collectorRef, date);
  return draft?.expenses.filter((row) => row.amount > 0) ?? [];
}

export function upsertDayExpenseDraft(
  drafts: CollectorDayExpenseDraft[],
  draft: CollectorDayExpenseDraft,
) {
  if (draft.expensesTotal <= 0 && draft.expenses.length === 0) {
    return drafts.filter((row) => row.ref !== draft.ref);
  }
  return [draft, ...drafts.filter((row) => row.ref !== draft.ref)];
}

export function removeDayExpenseDraft(
  drafts: CollectorDayExpenseDraft[],
  collectorRef: string,
  date: string,
) {
  const ref = dayExpenseDraftRef(collectorRef, date);
  return drafts.filter((row) => row.ref !== ref);
}

export function buildDayCloseExpenseMovements(input: {
  draft: CollectorDayCloseDraft;
  accountRef: string;
  lines: RouteExpenseLine[];
}): BankMovement[] {
  const { draft, accountRef, lines } = input;
  const period = periodFromIso(draft.date);
  return lines.map((line) => {
    const lineRef = dayExpenseLineMovementRef(draft.collectorRef, draft.date, line.id);
    return {
      ...addManualExpense({
        accountRef,
        period,
        description: `Gasto ruta · ${line.label} · ${draft.collectorName} · ${draft.date}`,
        valueDate: draft.date,
        opDate: draft.date,
        thirdParty: draft.collectorName,
        amount: line.amount,
        category: line.category,
      }),
      ref: lineRef,
      dayExpenseLineRef: lineRef,
    };
  });
}

type RouteExpenseSource = {
  collectorRef: string;
  collectorName: string;
  date: string;
  expenses: RouteExpenseLine[];
};

/**
 * Sube gastos de ruta (borradores + cierres) a Banco → Registros / Gastos.
 * Idempotente: actualiza o crea por dayExpenseLineRef.
 */
export function syncRouteExpensesToMovements(
  drafts: CollectorDayExpenseDraft[],
  closes: CollectorDayCloseRecord[],
  movements: BankMovement[],
  accountRef: string | null | undefined,
): BankMovement[] {
  if (!accountRef) return movements;

  const closedKeys = new Set(closes.map((row) => `${row.collectorRef}:${row.date}`));
  const sources: RouteExpenseSource[] = [
    ...closes.map((row) => ({
      collectorRef: row.collectorRef,
      collectorName: row.collectorName,
      date: row.date,
      expenses: row.expenses,
    })),
    ...drafts
      .filter((row) => !closedKeys.has(`${row.collectorRef}:${row.date}`))
      .map((row) => ({
        collectorRef: row.collectorRef,
        collectorName: row.collectorName,
        date: row.date,
        expenses: row.expenses,
      })),
  ];

  const wanted = new Map<string, { source: RouteExpenseSource; line: RouteExpenseLine }>();
  for (const source of sources) {
    for (const line of source.expenses) {
      if (line.amount <= 0) continue;
      const key = dayExpenseLineMovementRef(source.collectorRef, source.date, line.id);
      wanted.set(key, { source, line });
    }
  }

  const byLine = new Map(
    movements
      .filter((row) => row.dayExpenseLineRef)
      .map((row) => [row.dayExpenseLineRef as string, row]),
  );

  // No borrar gastos de ruta huérfanos si se perdieron cierres/borradores en storage.
  let next = [...movements];

  for (const [lineRef, { source, line }] of wanted) {
    const period = periodFromIso(source.date);
    const patch: BankMovement = {
      ref: lineRef,
      accountRef,
      period,
      description: `Gasto ruta · ${line.label} · ${source.collectorName} · ${source.date}`,
      valueDate: source.date,
      opDate: source.date,
      thirdParty: source.collectorName,
      debit: 0,
      credit: line.amount,
      category: line.category,
      dayExpenseLineRef: lineRef,
      inExtract: true,
      reconciled: false,
      manual: true,
    };
    const existing = byLine.get(lineRef) ?? next.find((row) => row.ref === lineRef);
    if (existing) {
      next = next.map((row) =>
        row.ref === existing.ref || row.dayExpenseLineRef === lineRef
          ? {
              ...row,
              ...patch,
              ref: existing.ref,
              reconciled: existing.reconciled,
            }
          : row,
      );
    } else {
      next = [patch, ...next];
    }
  }

  return next;
}

export function finalizeCollectorDayClose(input: {
  draft: CollectorDayCloseDraft;
  lines: RouteExpenseLine[];
  movementRefs: string[];
}): CollectorDayCloseRecord {
  const expensesTotal = sumExpenseLines(input.lines);
  const date = normalizeHistoryDate(input.draft.date) || input.draft.date;
  return {
    ...input.draft,
    date,
    ref: dayCloseRef(input.draft.collectorRef, date),
    closedAt: new Date().toISOString(),
    expenses: input.lines,
    expensesTotal,
    cashFloat: cashFloatAfterExpenses(input.draft.collected, expensesTotal),
    movementRefs: input.movementRefs,
  };
}

/**
 * Si ya hay CIE- del día pero la planilla no tiene dayClosedAt (cierre a medias),
 * sella las visitas para que la app muestre “Jornada cerrada”.
 */
export function applyDayCloseRecordsToAssignments(
  assignments: DailyCollectionAssignment[],
  dayCloses: CollectorDayCloseRecord[],
): DailyCollectionAssignment[] {
  if (!assignments.length || !dayCloses.length) return assignments;

  const byKey = new Map<string, CollectorDayCloseRecord>();
  for (const row of dayCloses) {
    const date = normalizeHistoryDate(row.date);
    if (!date || !row.collectorRef) continue;
    byKey.set(`${row.collectorRef}::${date}`, row);
  }
  if (!byKey.size) return assignments;

  return assignments.map((row) => {
    const date = normalizeHistoryDate(row.dispatchDate);
    if (!date) return row;
    const close = byKey.get(`${row.collectorRef}::${date}`);
    if (!close || row.dayClosedAt) return row;

    const closedAt =
      close.closedAt && !close.closedAt.includes("T") && close.closedAt.length <= 8
        ? close.closedAt
        : new Date(close.closedAt || Date.now()).toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
          });

    const paid =
      row.visitStatus === "cobrado" ||
      row.visitStatus === "omitido" ||
      Boolean(row.paymentRef);

    return {
      ...row,
      dispatched: true,
      dispatchedAt: row.dispatchedAt ?? close.closedAt,
      dayClosedAt: closedAt,
      amountDue: 0,
      visitStatus: paid
        ? row.visitStatus === "omitido"
          ? ("omitido" as const)
          : ("cobrado" as const)
        : ("omitido" as const),
      skipReason: paid ? row.skipReason : row.skipReason || "Cierre de jornada",
    };
  });
}

export function dayCloseSummaryLabel(record: CollectorDayCloseRecord) {
  return `Cierre ${record.date} · Recaudo ${money(record.collected)} · Gastos ${money(record.expensesTotal)} · Caja ${money(record.cashFloat)}`;
}

/** Fuentes opcionales para reconstruir historial si faltan cobros en storage. */
export type CollectorHistoryExtras = {
  dailyLogs?: CollectorDailyLogRow[];
  assignments?: DailyCollectionAssignment[];
};

/**
 * Reconstruye cobros perdidos desde la planilla (paymentRef + visita cobrada/parcial).
 */
export function recoverPaymentsFromAssignments(
  assignments: DailyCollectionAssignment[],
  existing: PaymentRow[],
): PaymentRow[] {
  const byRef = new Map(existing.map((row) => [row.ref, row]));
  for (const row of assignments) {
    if (!row.paymentRef || byRef.has(row.paymentRef)) continue;
    if (row.visitStatus !== "cobrado" && row.visitStatus !== "parcial") continue;
    const amount = Number(row.amountDue) || 0;
    if (amount <= 0) continue;
    const date = normalizeHistoryDate(row.dispatchDate);
    if (!date) continue;
    byRef.set(row.paymentRef, {
      ref: row.paymentRef,
      loanRef: row.loanRef || undefined,
      when: `${isoToDispatchLabel(date)} · 12:00`,
      paidDate: date,
      paidTime: "12:00",
      client: row.clientName,
      collector: row.collector,
      collectorRef: row.collectorRef,
      routeRef: undefined,
      amount,
      type: row.visitStatus === "parcial" ? "Abono" : "Cuota",
      kind: row.visitStatus === "parcial" ? "partial" : "paid",
      source: "pwa",
    });
  }
  return [...byRef.values()];
}

/**
 * Reconstruye cobros desde movimientos bancarios ligados a PG- / paymentRef.
 * Asocia cobrador y préstamo por paymentRef en planilla o por cliente+fecha.
 */
export function recoverPaymentsFromBankMovements(
  movements: BankMovement[],
  assignments: DailyCollectionAssignment[],
  existing: PaymentRow[],
): PaymentRow[] {
  const byRef = new Map(existing.map((row) => [row.ref, row]));
  for (const mov of movements) {
    const pg = paymentRefForMovement(mov);
    if (!pg || byRef.has(pg)) continue;
    const amount = Math.max(Number(mov.debit) || 0, Number(mov.credit) || 0);
    if (amount <= 0) continue;
    const date = normalizeHistoryDate(mov.valueDate || mov.opDate || "");
    if (!date) continue;
    const third = String(mov.thirdParty ?? "").trim().toLowerCase();
    const match =
      assignments.find((row) => row.paymentRef === pg) ??
      assignments.find(
        (row) =>
          normalizeHistoryDate(row.dispatchDate) === date &&
          Boolean(row.loanRef) &&
          row.clientName.trim().toLowerCase() === third,
      ) ??
      assignments.find(
        (row) =>
          normalizeHistoryDate(row.dispatchDate) === date &&
          row.clientName.trim().toLowerCase() === third,
      );
    byRef.set(pg, {
      ref: pg,
      when: `${isoToDispatchLabel(date)} · 12:00`,
      paidDate: date,
      paidTime: "12:00",
      client: match?.clientName || mov.thirdParty || "Cliente",
      collector: match?.collector || "",
      collectorRef: match?.collectorRef,
      loanRef: match?.loanRef || undefined,
      amount,
      type: "Cuota",
      kind: "paid",
      source: "pwa",
    });
  }
  // Completa loanRef/collectorRef en PG ya existentes si la planilla lo conoce.
  for (const [ref, pay] of byRef) {
    if (pay.loanRef && pay.collectorRef) continue;
    const match =
      assignments.find((row) => row.paymentRef === ref) ??
      assignments.find(
        (row) =>
          normalizeHistoryDate(row.dispatchDate) === normalizeHistoryDate(pay.paidDate ?? "") &&
          Boolean(row.loanRef) &&
          row.clientName.trim().toLowerCase() === (pay.client || "").trim().toLowerCase(),
      );
    if (!match) continue;
    byRef.set(ref, {
      ...pay,
      loanRef: pay.loanRef || match.loanRef || undefined,
      collectorRef: pay.collectorRef || match.collectorRef,
      collector: pay.collector || match.collector || "",
    });
  }
  return [...byRef.values()];
}

/**
 * Si la jornada quedó cerrada en planilla pero no hay registro CIE-, lo sintetiza
 * para que el historial muestre el día con su recaudo.
 */
export function synthesizeDayClosesFromAssignments(
  assignments: DailyCollectionAssignment[],
  payments: PaymentRow[],
  existing: CollectorDayCloseRecord[],
): CollectorDayCloseRecord[] {
  const byRef = new Map(existing.map((row) => [row.ref, row]));
  const groups = new Map<string, DailyCollectionAssignment[]>();
  for (const row of assignments) {
    if (!row.collectorRef || !row.dispatchDate) continue;
    const key = `${row.collectorRef}::${normalizeHistoryDate(row.dispatchDate)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [, rows] of groups) {
    const dispatched = rows.filter((row) => row.dispatched);
    if (!dispatched.length) continue;
    if (!dispatched.every((row) => Boolean(row.dayClosedAt))) continue;
    const sample = dispatched[0];
    const date = normalizeHistoryDate(sample.dispatchDate);
    if (!date) continue;
    const ref = dayCloseRef(sample.collectorRef, date);
    if (byRef.has(ref)) continue;

    const collectedFromPayments = payments
      .filter(
        (pay) =>
          pay.collectorRef === sample.collectorRef &&
          normalizeHistoryDate(pay.paidDate ?? "") === date,
      )
      .reduce((sum, pay) => sum + pay.amount, 0);
    const collectedFromVisits = dispatched
      .filter((row) => row.visitStatus === "cobrado" || row.visitStatus === "parcial")
      .reduce((sum, row) => sum + (Number(row.amountDue) || 0), 0);
    const collected = Math.max(collectedFromPayments, collectedFromVisits);
    const closedAt =
      dispatched.map((row) => row.dayClosedAt!).sort().slice(-1)[0] ?? new Date().toISOString();

    byRef.set(ref, {
      ref,
      collectorRef: sample.collectorRef,
      collectorName: sample.collector,
      date,
      routeRef: "",
      collected,
      expenses: [],
      expensesTotal: 0,
      cashFloat: collected,
      closedAt,
      movementRefs: [],
    });
  }

  return [...byRef.values()];
}

/**
 * Historial por día: cobro, gasto y saldo en mano (acumulado hasta consignar).
 * Gastos: cierre definitivo si existe; si no, borrador guardado del día.
 * Arrastra saldo del cierre de mes anterior.
 * Más reciente primero. Por defecto filtra al mes de `viewPeriod`.
 * Si faltan pagos, usa cierres, logs diarios y planilla cerrada.
 */
export function buildCollectorDayHistory(
  collectorRef: string,
  payments: PaymentRow[],
  closes: CollectorDayCloseRecord[],
  collectors: CollectorRow[] = [],
  extraDates: string[] = [],
  expenseDrafts: CollectorDayExpenseDraft[] = [],
  monthCloses: CollectorMonthCloseRecord[] = [],
  viewPeriod?: string,
  extras: CollectorHistoryExtras = {},
): CollectorDayHistoryRow[] {
  const mine = paymentsForCollector(collectorRef, collectors, payments);
  const cobroByDate = new Map<string, number>();
  for (const row of mine) {
    const date = normalizeHistoryDate(row.paidDate ?? "");
    if (!date) continue;
    cobroByDate.set(date, (cobroByDate.get(date) ?? 0) + row.amount);
  }

  // Planilla: visitas cobradas sin pago en storage.
  for (const row of extras.assignments ?? []) {
    if (row.collectorRef !== collectorRef) continue;
    if (row.visitStatus !== "cobrado" && row.visitStatus !== "parcial") continue;
    const date = normalizeHistoryDate(row.dispatchDate);
    if (!date) continue;
    const amount = Number(row.amountDue) || 0;
    if (amount <= 0) continue;
    // Solo suma si ese paymentRef no está ya en payments (evita doble conteo).
    if (row.paymentRef && mine.some((pay) => pay.ref === row.paymentRef)) continue;
    cobroByDate.set(date, (cobroByDate.get(date) ?? 0) + amount);
  }

  // Logs diarios (archivo de jornadas).
  for (const row of extras.dailyLogs ?? []) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date) continue;
    const fromPayments = cobroByDate.get(date) ?? 0;
    if (row.collected > fromPayments) cobroByDate.set(date, row.collected);
  }

  const closedDates = new Set<string>();
  const gastoByDate = new Map<string, number>();
  for (const row of closes) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date) continue;
    closedDates.add(date);
    gastoByDate.set(date, (gastoByDate.get(date) ?? 0) + row.expensesTotal);
    // Si se perdieron pagos en storage, el cierre del día aún guarda el recaudo.
    const fromPayments = cobroByDate.get(date) ?? 0;
    if (row.collected > fromPayments) {
      cobroByDate.set(date, row.collected);
    }
  }
  for (const row of expenseDrafts) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date || closedDates.has(date)) continue;
    gastoByDate.set(date, row.expensesTotal);
  }

  // Fechas cerradas en planilla aunque no haya cobro/gasto numérico.
  for (const row of extras.assignments ?? []) {
    if (row.collectorRef !== collectorRef || !row.dayClosedAt) continue;
    const date = normalizeHistoryDate(row.dispatchDate);
    if (date) closedDates.add(date);
  }

  let dates = [
    ...new Set([
      ...cobroByDate.keys(),
      ...gastoByDate.keys(),
      ...closedDates,
      ...extraDates.map(normalizeHistoryDate).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const period =
    viewPeriod ??
    (dates[dates.length - 1] ? periodFromDateIso(dates[dates.length - 1]) : undefined);
  if (period) {
    dates = dates.filter((date) => periodFromDateIso(date) === period);
  }

  const opening = period ? openingSaldoForPeriod(collectorRef, period, monthCloses) : 0;
  let running = opening;
  const ascending: CollectorDayHistoryRow[] = dates.map((date) => {
    const cobro = cobroByDate.get(date) ?? 0;
    const gasto = gastoByDate.get(date) ?? 0;
    running = running + cobro - gasto;
    return {
      date,
      dateLabel: historyDayLabel(date, period ?? periodFromDateIso(date)),
      cobro,
      gasto,
      saldo: running,
    };
  });

  return ascending.reverse();
}

/** Saldo final del mes (último día con movimiento o opening si vacío). */
export function monthClosingSaldoFromHistory(rows: CollectorDayHistoryRow[], openingSaldo = 0) {
  if (!rows.length) return openingSaldo;
  const oldestFirst = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return oldestFirst[oldestFirst.length - 1]?.saldo ?? openingSaldo;
}

/** ¿Hubo cobros/gastos en ese periodo? */
export function periodHadCollectorActivity(
  collectorRef: string,
  period: string,
  payments: PaymentRow[],
  closes: CollectorDayCloseRecord[],
  drafts: CollectorDayExpenseDraft[],
  collectors: CollectorRow[] = [],
) {
  const mine = paymentsForCollector(collectorRef, collectors, payments);
  if (mine.some((row) => row.paidDate && periodFromDateIso(row.paidDate) === period)) return true;
  if (
    closes.some(
      (row) => row.collectorRef === collectorRef && periodFromDateIso(row.date) === period,
    )
  ) {
    return true;
  }
  if (
    drafts.some(
      (row) => row.collectorRef === collectorRef && periodFromDateIso(row.date) === period,
    )
  ) {
    return true;
  }
  return false;
}
