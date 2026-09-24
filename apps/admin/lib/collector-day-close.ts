import {
  addManualExpense,
  paymentRefForMovement,
  periodFromIso,
  type BankExpenseCategory,
  type BankMovement,
} from "@/lib/bank";
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { pesos, sumPesos, verifyCashClose } from "@/lib/finance";
import { displayToIso } from "@/lib/loan-preview";
import { money, type CollectorRow, type LoanRow, type PaymentRow, paymentsForCollector } from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";
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
  /** Desembolso de préstamo en efectivo: ancla el Haber al préstamo (varios por día). */
  loanRef?: string;
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
  /** Recaudo en efectivo − gastos: queda en caja menor hasta consignar. */
  cashFloat: number;
  /** Saldo con el que arrancó la caja ese día. */
  openingCash?: number;
  /** Resultado de inicial + efectivo − gastos. */
  cashExpected?: number;
  /** Caja que se declaró antes de cuadrar. No se reescribe el cobro ni el gasto. */
  cashDeclared?: number;
  /** declarado − esperado. 0 = cuadra. */
  cashVariance?: number;
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
  /** Total cobrado del día (efectivo + Nequi). */
  cobro: number;
  /** Solo efectivo: carga la caja menor del cobrador. */
  cobroEfectivo: number;
  /** Nequi: pago directo a cuenta del dueño; no suma a caja del cobrador. */
  cobroNequi: number;
  gasto: number;
  /** Saldo en mano al cierre del día (arrastre: inicial + efectivo − gastos). */
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
  return sumPesos(lines.map((line) => line.amount));
}

export function cashFloatAfterExpenses(collected: number, expensesTotal: number) {
  return verifyCashClose({
    opening: 0,
    collections: collected,
    expenses: expensesTotal,
    declared: 0,
  }).expected;
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
  loanRef?: string,
) {
  if (loanRef) {
    return `GASL-${collectorRef}-${date}-prestamo-${loanRef}`;
  }
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

/**
 * Desembolso del cobrador en efectivo → gasto «Préstamo» del día (resta En caja).
 * Idempotente por loanRef.
 */
export function appendCashDisbursementExpense(
  drafts: CollectorDayExpenseDraft[],
  input: {
    collectorRef: string;
    collectorName: string;
    date: string;
    routeRef: string;
    loan: Pick<LoanRow, "ref" | "client" | "capital">;
  },
): CollectorDayExpenseDraft[] {
  const capital = Math.trunc(Number(input.loan.capital) || 0);
  if (capital <= 0 || !input.collectorRef || !input.date) return drafts;
  const existing = findDayExpenseDraft(drafts, input.collectorRef, input.date);
  const line: RouteExpenseLine = {
    id: "prestamo",
    label: `Préstamo · ${input.loan.ref} · ${input.loan.client}`,
    amount: capital,
    category: "prestamo_ruta",
    loanRef: input.loan.ref,
  };
  const prev = (existing?.expenses ?? []).filter((row) => row.loanRef !== input.loan.ref);
  return upsertDayExpenseDraft(
    drafts,
    buildDayExpenseDraft({
      collectorRef: input.collectorRef,
      collectorName: input.collectorName,
      date: input.date,
      routeRef: input.routeRef || existing?.routeRef || "",
      expenses: [...prev, line],
    }),
  );
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
    const lineRef = dayExpenseLineMovementRef(
      draft.collectorRef,
      draft.date,
      line.id,
      line.loanRef,
    );
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
 * Incluye préstamos en efectivo (azul) y gastos operativos (rojo).
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
      const key = dayExpenseLineMovementRef(
        source.collectorRef,
        source.date,
        line.id,
        line.loanRef,
      );
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
  /**
   * Efectivo del día para caja menor.
   * Nequi no entra: va a cuenta del dueño. Si falta, usa draft.collected (legado).
   */
  cashCollected?: number;
}): CollectorDayCloseRecord {
  const expensesTotal = sumExpenseLines(input.lines);
  const date = normalizeHistoryDate(input.draft.date) || input.draft.date;
  const cashBase = pesos(
    typeof input.cashCollected === "number" ? input.cashCollected : input.draft.collected,
  );
  const check = verifyCashClose({
    opening: 0,
    collections: cashBase,
    expenses: expensesTotal,
    declared: cashBase - expensesTotal,
  });
  return {
    ...input.draft,
    date,
    ref: dayCloseRef(input.draft.collectorRef, date),
    closedAt: new Date().toISOString(),
    expenses: input.lines,
    expensesTotal,
    openingCash: check.opening,
    cashExpected: check.expected,
    cashDeclared: check.expected,
    cashVariance: 0,
    cashFloat: check.expected,
    movementRefs: input.movementRefs,
  };
}

/** Historial visible/guardado del cobrador: siempre los últimos 30 días. */
export const COLLECTOR_HISTORY_KEEP_DAYS = 30;

/** Día más antiguo que entra en la ventana (hoy inclusive). Al día 31 cae este. */
export function historyKeepCutoffIso(today = todayIso(), days = COLLECTOR_HISTORY_KEEP_DAYS) {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - (days - 1));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Por cobrador: conserva solo los N cierres más recientes (por fecha).
 * Al guardar el día 31, cae el más antiguo.
 */
export function trimCollectorDayClosesHistory(
  closes: CollectorDayCloseRecord[],
  keepDays = COLLECTOR_HISTORY_KEEP_DAYS,
): CollectorDayCloseRecord[] {
  if (!closes.length || keepDays <= 0) return closes;
  const byCollector = new Map<string, CollectorDayCloseRecord[]>();
  const orphan: CollectorDayCloseRecord[] = [];
  for (const row of closes) {
    const ref = String(row.collectorRef ?? "").trim();
    if (!ref) {
      orphan.push(row);
      continue;
    }
    const list = byCollector.get(ref) ?? [];
    list.push(row);
    byCollector.set(ref, list);
  }
  const kept: CollectorDayCloseRecord[] = [...orphan];
  for (const rows of byCollector.values()) {
    const byDate = new Map<string, CollectorDayCloseRecord>();
    for (const row of rows) {
      const date = normalizeHistoryDate(row.date);
      if (!date) {
        kept.push(row);
        continue;
      }
      const prev = byDate.get(date);
      if (!prev || String(row.closedAt ?? "") >= String(prev.closedAt ?? "")) {
        byDate.set(date, row);
      }
    }
    const newestFirst = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
    for (const date of newestFirst.slice(0, keepDays)) {
      const row = byDate.get(date);
      if (row) kept.push(row);
    }
  }
  return kept;
}

/** Inserta/actualiza un CIE y deja solo los últimos N días de ese cobrador. */
export function upsertAndTrimCollectorDayClose(
  closes: CollectorDayCloseRecord[],
  record: CollectorDayCloseRecord,
  keepDays = COLLECTOR_HISTORY_KEEP_DAYS,
): CollectorDayCloseRecord[] {
  return trimCollectorDayClosesHistory(
    [record, ...closes.filter((row) => row.ref !== record.ref)],
    keepDays,
  );
}

/**
 * Si ya hay CIE- del día pero la planilla no tiene dayClosedAt (cierre a medias),
 * sella las visitas que existían al cerrar.
 * Visitas NUEVAS (p. ej. préstamo creado después del CIE) no se omiten: siguen pendientes.
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
    if (!close) return row;

    const closeMs = Date.parse(String(close.closedAt || ""));
    const bornMs = Date.parse(String(row.assignedAt || row.dispatchedAt || ""));
    const bornAfterClose =
      Number.isFinite(closeMs) && Number.isFinite(bornMs) && bornMs > closeMs;

    // Préstamo/visita nacida después del cierre → no sellar (y deshacer sello erróneo).
    if (bornAfterClose) {
      if (!row.dayClosedAt && row.visitStatus !== "omitido") return row;
      if (row.paymentRef || row.visitStatus === "cobrado") return row;
      return {
        ...row,
        dayClosedAt: undefined,
        visitStatus: "pendiente" as const,
        skipReason: undefined,
        amountDue: Math.max(0, Number(row.amountDue) || 0),
      };
    }

    if (row.dayClosedAt) return row;

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
  const base = `Cierre ${record.date} · Recaudo ${money(record.collected)} · Gastos ${money(record.expensesTotal)} · Caja ${money(record.cashFloat)}`;
  const variance = record.cashVariance ?? 0;
  if (!variance) return base;
  return `${base} · Descuadre ${money(variance)}`;
}

/** Fuentes opcionales para reconstruir historial si faltan cobros en storage. */
export type CollectorHistoryExtras = {
  dailyLogs?: CollectorDailyLogRow[];
  assignments?: DailyCollectionAssignment[];
  /** Últimos N días corridos, aunque crucen de mes. El día 31 suelta el más antiguo. */
  rolling?: boolean;
  /**
   * Planilla activa (1 / 1.1): solo cuenta PG- y desembolsos de estos clientes.
   * Sin inventar montos de otra hoja.
   */
  clientRefs?: ReadonlySet<string>;
  loans?: LoanRow[];
  /** false = no suma gastos operativos (caja); solo préstamos de la ruta. */
  includeOperatingExpenses?: boolean;
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
 * Historial por día: cobro, gasto y saldo en mano.
 * - `cobro` = total (efectivo + Nequi) para informar recaudo.
 * - Saldo en mano solo suma **efectivo** (Nequi va a cuenta del dueño).
 * Gastos: cierre definitivo si existe; si no, borrador del día.
 * Arrastra saldo del cierre de mes anterior. Más reciente primero.
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
  const scopeRefs = extras.clientRefs;
  const scopeLoans = extras.loans ?? [];
  const includeOperating = extras.includeOperatingExpenses !== false;
  const loanClientRef = (loanRef: string | undefined) => {
    if (!loanRef) return "";
    return scopeLoans.find((row) => row.ref === loanRef)?.clientRef ?? "";
  };
  const paymentInScope = (loanRef: string | undefined) => {
    if (!scopeRefs) return true;
    const clientRef = loanClientRef(loanRef);
    return Boolean(clientRef && scopeRefs.has(clientRef));
  };
  const expensesTotalInScope = (expenses: RouteExpenseLine[]) => {
    let total = 0;
    for (const line of expenses) {
      const amount = Number(line.amount) || 0;
      if (!(amount > 0)) continue;
      const isPrestamo = line.category === "prestamo_ruta" || line.id === "prestamo";
      if (isPrestamo) {
        if (!paymentInScope(line.loanRef)) continue;
        total += amount;
        continue;
      }
      if (!includeOperating) continue;
      total += amount;
    }
    return total;
  };

  const mine = paymentsForCollector(collectorRef, collectors, payments);
  const cobroByDate = new Map<string, number>();
  const efectivoByDate = new Map<string, number>();
  const nequiByDate = new Map<string, number>();
  for (const row of mine) {
    if (!paymentInScope(row.loanRef)) continue;
    const date = normalizeHistoryDate(row.paidDate ?? "");
    if (!date) continue;
    const amount = Number(row.amount) || 0;
    if (!(amount > 0)) continue;
    cobroByDate.set(date, (cobroByDate.get(date) ?? 0) + amount);
    const method = normalizePaymentMethod(row.method);
    if (method === "nequi") {
      nequiByDate.set(date, (nequiByDate.get(date) ?? 0) + amount);
    } else if (method === "efectivo") {
      efectivoByDate.set(date, (efectivoByDate.get(date) ?? 0) + amount);
    }
    // Banco: va en cobro total, no a caja ni a pool Nequi.
  }

  const closedDates = new Set<string>();
  const gastoByDate = new Map<string, number>();
  for (const row of closes) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date) continue;
    closedDates.add(date);
    const gasto = scopeRefs
      ? expensesTotalInScope(row.expenses ?? [])
      : row.expensesTotal;
    gastoByDate.set(date, (gastoByDate.get(date) ?? 0) + gasto);
  }
  for (const row of expenseDrafts) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date || closedDates.has(date)) continue;
    const gasto = scopeRefs
      ? expensesTotalInScope(row.expenses ?? [])
      : row.expensesTotal;
    gastoByDate.set(date, gasto);
  }

  for (const row of extras.assignments ?? []) {
    if (row.collectorRef !== collectorRef || !row.dayClosedAt) continue;
    if (scopeRefs && row.clientRef && !scopeRefs.has(row.clientRef)) continue;
    const date = normalizeHistoryDate(row.dispatchDate);
    if (date) closedDates.add(date);
  }

  for (const row of extras.dailyLogs ?? []) {
    if (row.collectorRef !== collectorRef) continue;
    const date = normalizeHistoryDate(row.date);
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

  if (extras.rolling) {
    const cutoff = historyKeepCutoffIso();
    const byPeriod = new Map<string, string[]>();
    for (const date of dates) {
      const bucketPeriod = periodFromDateIso(date);
      const bucket = byPeriod.get(bucketPeriod);
      if (bucket) bucket.push(date);
      else byPeriod.set(bucketPeriod, [date]);
    }
    const ascending: CollectorDayHistoryRow[] = [];
    for (const bucketPeriod of [...byPeriod.keys()].sort()) {
      let running = openingSaldoForPeriod(collectorRef, bucketPeriod, monthCloses);
      const labelPeriod = viewPeriod || bucketPeriod;
      for (const date of byPeriod.get(bucketPeriod) ?? []) {
        const cobroEfectivo = efectivoByDate.get(date) ?? 0;
        const gasto = gastoByDate.get(date) ?? 0;
        running = verifyCashClose({
          opening: running,
          collections: cobroEfectivo,
          expenses: gasto,
          declared: running,
        }).expected;
        if (date < cutoff) continue;
        ascending.push({
          date,
          dateLabel: historyDayLabel(date, labelPeriod),
          cobro: cobroByDate.get(date) ?? 0,
          cobroEfectivo,
          cobroNequi: nequiByDate.get(date) ?? 0,
          gasto,
          saldo: running,
        });
      }
    }
    return ascending.slice(-COLLECTOR_HISTORY_KEEP_DAYS).reverse();
  }

  const period =
    viewPeriod ??
    (dates[dates.length - 1] ? periodFromDateIso(dates[dates.length - 1]) : undefined);
  if (period) {
    dates = dates.filter((date) => periodFromDateIso(date) === period);
  }

  const opening = period ? openingSaldoForPeriod(collectorRef, period, monthCloses) : 0;
  let running = opening;

  // Solo últimos N días en el historial del cobrador; el saldo arrastra lo anterior.
  const dropCount = Math.max(0, dates.length - COLLECTOR_HISTORY_KEEP_DAYS);
  for (let i = 0; i < dropCount; i += 1) {
    const date = dates[i];
    running = verifyCashClose({
      opening: running,
      collections: efectivoByDate.get(date) ?? 0,
      expenses: gastoByDate.get(date) ?? 0,
      declared: running,
    }).expected;
  }
  dates = dates.slice(dropCount);

  const ascending: CollectorDayHistoryRow[] = dates.map((date) => {
    const cobro = cobroByDate.get(date) ?? 0;
    const cobroEfectivo = efectivoByDate.get(date) ?? 0;
    const cobroNequi = nequiByDate.get(date) ?? 0;
    const gasto = gastoByDate.get(date) ?? 0;
    const check = verifyCashClose({
      opening: running,
      collections: cobroEfectivo,
      expenses: gasto,
      declared: running,
    });
    running = check.expected;
    return {
      date,
      dateLabel: historyDayLabel(date, period ?? periodFromDateIso(date)),
      cobro,
      cobroEfectivo,
      cobroNequi,
      gasto,
      saldo: running,
    };
  });

  return ascending.reverse();
}

/**
 * Alinea `CIE.collected` (total del día) y caja menor con pagos reales.
 * `collected` = efectivo + Nequi; `cashFloat` = solo efectivo − gastos.
 */
export function alignDayClosesCollectedToPayments(
  closes: CollectorDayCloseRecord[],
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
): CollectorDayCloseRecord[] {
  if (!closes.length) return closes;
  let changed = false;
  const next = closes.map((row) => {
    const breakdown = collectorRecaudoBreakdownForClose(
      row.collectorRef,
      row.date,
      payments,
      collectors,
    );
    const expensesTotal = sumExpenseLines(row.expenses ?? []);
    const declared = pesos(row.cashDeclared ?? row.cashFloat);
    const check = verifyCashClose({
      opening: pesos(row.openingCash ?? 0),
      collections: breakdown.efectivo,
      expenses: expensesTotal,
      declared,
    });
    const cashVariance =
      row.cashVariance != null && row.cashVariance !== 0 ? pesos(row.cashVariance) : check.variance;
    if (
      row.collected === breakdown.total &&
      row.expensesTotal === expensesTotal &&
      row.cashFloat === check.expected &&
      row.cashExpected === check.expected &&
      row.cashDeclared === declared &&
      row.cashVariance === cashVariance
    ) {
      return row;
    }
    changed = true;
    return {
      ...row,
      collected: breakdown.total,
      expenses: row.expenses,
      expensesTotal,
      openingCash: check.opening,
      cashExpected: check.expected,
      cashDeclared: declared,
      cashVariance,
      cashFloat: check.expected,
    };
  });
  return changed ? next : closes;
}

function collectorRecaudoBreakdownForClose(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[],
) {
  const norm = normalizeHistoryDate(date) || date;
  let total = 0;
  let efectivo = 0;
  let nequi = 0;
  let banco = 0;
  for (const row of paymentsForCollector(collectorRef, collectors, payments)) {
    if (normalizeHistoryDate(row.paidDate || "") !== norm) continue;
    const amount = Number(row.amount) || 0;
    if (!(amount > 0)) continue;
    total += amount;
    const method = normalizePaymentMethod(row.method);
    if (method === "nequi") nequi += amount;
    else if (method === "banco") banco += amount;
    else efectivo += amount;
  }
  return { total, efectivo, nequi, banco, digital: nequi + banco };
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
