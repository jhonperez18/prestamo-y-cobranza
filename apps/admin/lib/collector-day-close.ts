import {
  addManualExpense,
  periodFromIso,
  type BankExpenseCategory,
  type BankMovement,
} from "@/lib/bank";
import { money, type CollectorRow, type PaymentRow, paymentsForCollector } from "@/lib/mock-data";

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

export function periodFromDateIso(iso: string) {
  return iso.slice(0, 7);
}

export function dayNumberFromIso(iso: string) {
  const day = Number(iso.slice(8, 10));
  return Number.isFinite(day) ? String(day) : iso;
}

export function isLastCalendarDayOfMonth(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
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
  const period = periodFromDateIso(iso);
  const day = dayNumberFromIso(iso);
  if (period === viewPeriod) return day;
  const [, month] = iso.split("-");
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

  let next = movements.filter(
    (row) => !row.dayExpenseLineRef || wanted.has(row.dayExpenseLineRef),
  );

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
  return {
    ...input.draft,
    ref: dayCloseRef(input.draft.collectorRef, input.draft.date),
    closedAt: new Date().toISOString(),
    expenses: input.lines,
    expensesTotal,
    cashFloat: cashFloatAfterExpenses(input.draft.collected, expensesTotal),
    movementRefs: input.movementRefs,
  };
}

export function dayCloseSummaryLabel(record: CollectorDayCloseRecord) {
  return `Cierre ${record.date} · Recaudo ${money(record.collected)} · Gastos ${money(record.expensesTotal)} · Caja ${money(record.cashFloat)}`;
}

/**
 * Historial por día: cobro, gasto y saldo en mano (acumulado hasta consignar).
 * Gastos: cierre definitivo si existe; si no, borrador guardado del día.
 * Arrastra saldo del cierre de mes anterior.
 * Más reciente primero. Por defecto filtra al mes de `viewPeriod`.
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
): CollectorDayHistoryRow[] {
  const mine = paymentsForCollector(collectorRef, collectors, payments);
  const cobroByDate = new Map<string, number>();
  for (const row of mine) {
    const date = row.paidDate;
    if (!date) continue;
    cobroByDate.set(date, (cobroByDate.get(date) ?? 0) + row.amount);
  }

  const closedDates = new Set<string>();
  const gastoByDate = new Map<string, number>();
  for (const row of closes) {
    if (row.collectorRef !== collectorRef) continue;
    closedDates.add(row.date);
    gastoByDate.set(row.date, (gastoByDate.get(row.date) ?? 0) + row.expensesTotal);
  }
  for (const row of expenseDrafts) {
    if (row.collectorRef !== collectorRef) continue;
    if (closedDates.has(row.date)) continue;
    gastoByDate.set(row.date, row.expensesTotal);
  }

  let dates = [
    ...new Set([
      ...cobroByDate.keys(),
      ...gastoByDate.keys(),
      ...extraDates,
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const period = viewPeriod ?? (dates[dates.length - 1] ? periodFromDateIso(dates[dates.length - 1]) : undefined);
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
  if (closes.some((row) => row.collectorRef === collectorRef && periodFromDateIso(row.date) === period)) {
    return true;
  }
  if (drafts.some((row) => row.collectorRef === collectorRef && periodFromDateIso(row.date) === period)) {
    return true;
  }
  return false;
}
