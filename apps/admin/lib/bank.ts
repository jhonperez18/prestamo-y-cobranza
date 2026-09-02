import type { PaymentRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";
import type { MiscPayment } from "@/lib/misc-payments";
import { findMiscPaymentForMovement } from "@/lib/misc-payments";

export type BankAccountType =
  | "corriente"
  | "ahorros"
  | "caja"
  | "nequi"
  | "otro";

export type BankAccount = {
  ref: string;
  /** Etiqueta cuenta o caja */
  name: string;
  bankName: string;
  accountNumber: string;
  accountType: BankAccountType;
  currency: string;
  country: string;
  province: string;
  address: string;
  active: boolean;
  openingBalance: number;
};

export function bankAccountTypeLabel(type: BankAccountType) {
  if (type === "corriente") return "Cuenta corriente, cheque o tarjeta";
  if (type === "ahorros") return "Cuenta de ahorros";
  if (type === "caja") return "Caja / efectivo";
  if (type === "nequi") return "Nequi / billetera digital";
  return "Otro";
}

export function normalizeBankAccount(row: Partial<BankAccount> & Pick<BankAccount, "ref" | "name">): BankAccount {
  return {
    ref: row.ref,
    name: row.name,
    bankName: row.bankName?.trim() || "Sin banco",
    accountNumber: row.accountNumber?.trim() || "Sin número",
    accountType: row.accountType ?? "corriente",
    currency: row.currency ?? "COP",
    country: row.country ?? "Colombia (CO)",
    province: row.province ?? "",
    address: row.address ?? "",
    active: row.active !== false,
    openingBalance: Number(row.openingBalance) || 0,
  };
}

export type BankExpenseCategory =
  | "nomina"
  | "administracion"
  | "domicilio"
  | "servicios"
  | "otro";

export type BankMovement = {
  ref: string;
  accountRef: string;
  period: string;
  description: string;
  valueDate: string;
  opDate: string;
  thirdParty: string;
  debit: number;
  credit: number;
  category?: BankExpenseCategory;
  paymentRef?: string;
  miscPaymentRef?: string;
  inExtract: boolean;
  reconciled: boolean;
  manual: boolean;
};

export type BankReconciliation = {
  accountRef: string;
  period: string;
  closedAt: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

export type BankExtractSummary = {
  period: string;
  openingBalance: number;
  closingBalance: number;
  closed: boolean;
};

export type BankMovementRow = BankMovement & {
  runningBalance: number;
};

export type BankPeriodSummary = {
  period: string;
  label: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  closed: boolean;
};

export type BankReportMonth = {
  month: number;
  label: string;
  gastos: number;
  ingresos: number;
};

export type BankReportYear = {
  key: string;
  label: string;
  months: BankReportMonth[];
  totalGastos: number;
  totalIngresos: number;
  resultado: number;
};

const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

let movementCounter = 0;

export function nextBankMovementRef(prefix = "BNK") {
  movementCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${movementCounter}`;
}

export function nextBankAccountRef(existing: BankAccount[]) {
  const nums = existing
    .map((row) => Number(row.ref.replace(/^BCA-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `BCA-${next}`;
}

export function normalizeBankAccountRef(input: string) {
  return input.trim();
}

export function normalizeBankMovement(
  row: Partial<BankMovement> & { ref?: string },
): BankMovement | null {
  if (!row.ref) return null;
  const valueDate = row.valueDate ?? row.opDate ?? displayToday();
  const opDate = row.opDate ?? valueDate;
  const period =
    row.period && isValidBankPeriod(row.period)
      ? normalizeBankPeriod(row.period)
      : periodFromIso(valueDate);
  return {
    ref: row.ref,
    accountRef: row.accountRef ?? "",
    period,
    description: row.description ?? "",
    valueDate,
    opDate,
    thirdParty: row.thirdParty ?? "",
    debit: Number(row.debit) || 0,
    credit: Number(row.credit) || 0,
    category: row.category,
    paymentRef: row.paymentRef,
    miscPaymentRef: row.miscPaymentRef,
    inExtract: row.inExtract !== false,
    reconciled: Boolean(row.reconciled),
    manual: Boolean(row.manual),
  };
}

export function normalizeBankMovements(rows: BankMovement[]) {
  return rows
    .map((row) => normalizeBankMovement(row))
    .filter((row): row is BankMovement => row !== null);
}

export function compareBankMovementsChronological(a: BankMovement, b: BankMovement) {
  const dateCmp = a.valueDate.localeCompare(b.valueDate);
  if (dateCmp !== 0) return dateCmp;
  const periodCmp = a.period.localeCompare(b.period);
  if (periodCmp !== 0) return periodCmp;
  return a.ref.localeCompare(b.ref);
}

export type BankMovementSortKey = "valueDate" | "debit" | "credit";
export type BankSortDir = "asc" | "desc";

export function sortBankMovements(
  rows: BankMovement[],
  sortKey: BankMovementSortKey,
  sortDir: BankSortDir,
): BankMovement[] {
  const copy = [...rows];
  if (sortKey === "valueDate") {
    copy.sort(compareBankMovementsChronological);
    if (sortDir === "desc") copy.reverse();
    return copy;
  }
  copy.sort((a, b) => {
    const aVal = sortKey === "debit" ? a.debit : a.credit;
    const bVal = sortKey === "debit" ? b.debit : b.credit;
    if (aVal !== bVal) return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    return compareBankMovementsChronological(a, b);
  });
  return copy;
}

export function bankMovementsWithDisplayBalance(
  rows: BankMovement[],
  sortKey: BankMovementSortKey,
  sortDir: BankSortDir,
  openingBalance: number,
): BankMovementRow[] {
  if (sortKey === "valueDate") {
    const sorted = [...rows].sort(compareBankMovementsChronological);
    const withBalance = withRunningBalance(sorted, openingBalance);
    return sortDir === "desc" ? [...withBalance].reverse() : withBalance;
  }
  const balanceMap = new Map(
    withRunningBalance([...rows].sort(compareBankMovementsChronological), openingBalance).map(
      (row) => [row.ref, row.runningBalance],
    ),
  );
  return sortBankMovements(rows, sortKey, sortDir).map((row) => ({
    ...row,
    runningBalance: balanceMap.get(row.ref) ?? openingBalance,
  }));
}

export function isBankAccountRefTaken(existing: BankAccount[], ref: string, exceptRef?: string) {
  const normalized = normalizeBankAccountRef(ref).toLowerCase();
  if (!normalized) return false;
  return existing.some(
    (row) => row.ref.toLowerCase() === normalized && row.ref !== exceptRef,
  );
}

export function periodFromIso(iso?: string) {
  if (!iso || iso.length < 7) return currentPeriod();
  return iso.slice(0, 7);
}

export function currentPeriod() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-");
  const idx = Number(month) - 1;
  if (!year || idx < 0 || idx > 11) return period;
  return `${MONTH_LABELS[idx]} ${year}`;
}

/** Periodo bancario en formato año-mes (YYYY-MM). */
export function isValidBankPeriod(period: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period.trim());
  return Boolean(match);
}

export function normalizeBankPeriod(input: string) {
  return input.trim();
}

export function periodsForAccount(
  accountRef: string,
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
) {
  const periods = new Set<string>();
  for (const row of movements) {
    if (row.accountRef === accountRef) periods.add(row.period);
  }
  for (const row of reconciliations) {
    if (row.accountRef === accountRef) periods.add(row.period);
  }
  return periods;
}

/** Saldo inicial encadenado del periodo según cierres anteriores. */
export function openingBalanceForPeriod(
  accountRef: string,
  period: string,
  accountOpeningBalance: number,
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
) {
  const periods = [...periodsForAccount(accountRef, movements, reconciliations)];
  if (!periods.includes(period)) periods.push(period);
  periods.sort((a, b) => a.localeCompare(b));

  let running = accountOpeningBalance;
  for (const p of periods) {
    if (p === period) return running;
    const recon = reconciliations.find((row) => row.accountRef === accountRef && row.period === p);
    if (recon) {
      running = recon.balance;
      continue;
    }
    const rows = movementsForAccountPeriod(movements, accountRef, p);
    running += summarizeMovements(rows).balance;
  }
  return accountOpeningBalance;
}

/** Listado mensual de extractos con saldo inicial y final por cuenta. */
export function listAccountExtracts(
  accountRef: string,
  accountOpeningBalance: number,
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
): BankExtractSummary[] {
  const periods = periodsForAccount(accountRef, movements, reconciliations);
  periods.add(currentPeriod());

  const asc = [...periods].sort((a, b) => a.localeCompare(b));
  const byPeriod = new Map<string, BankExtractSummary>();
  let runningOpening = accountOpeningBalance;

  for (const period of asc) {
    const rows = movementsForAccountPeriod(movements, accountRef, period);
    const summary = summarizeMovements(rows);
    const recon = reconciliations.find((row) => row.accountRef === accountRef && row.period === period);
    const openingBalance = runningOpening;
    const closingBalance = recon ? recon.balance : openingBalance + summary.balance;
    const hasActivity = rows.length > 0 || Boolean(recon);
    if (hasActivity || period === currentPeriod()) {
      byPeriod.set(period, {
        period,
        openingBalance,
        closingBalance,
        closed: Boolean(recon),
      });
    }
    runningOpening = closingBalance;
  }

  return [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period));
}

export function renameAccountExtractPeriod(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accountRef: string,
  fromPeriod: string,
  toPeriod: string,
) {
  const nextPeriod = normalizeBankPeriod(toPeriod);
  if (!isValidBankPeriod(nextPeriod)) {
    return { ok: false as const, error: "La referencia debe tener formato año-mes (YYYY-MM)." };
  }
  if (fromPeriod === nextPeriod) {
    return { ok: true as const, movements, reconciliations };
  }
  const duplicate = reconciliations.some(
    (row) => row.accountRef === accountRef && row.period === nextPeriod,
  );
  const duplicateMovements = movements.some(
    (row) => row.accountRef === accountRef && row.period === nextPeriod,
  );
  if (duplicate || duplicateMovements) {
    return { ok: false as const, error: `Ya existe un extracto con referencia ${nextPeriod}.` };
  }

  const nextMovements = movements.map((row) =>
    row.accountRef === accountRef && row.period === fromPeriod
      ? { ...row, period: nextPeriod }
      : row,
  );
  const nextReconciliations = reconciliations.map((row) =>
    row.accountRef === accountRef && row.period === fromPeriod
      ? { ...row, period: nextPeriod }
      : row,
  );
  return { ok: true as const, movements: nextMovements, reconciliations: nextReconciliations };
}

export function isoToDisplay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function displayToday() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function expenseCategoryLabel(category?: BankExpenseCategory) {
  if (category === "nomina") return "Nómina";
  if (category === "administracion") return "Administración";
  if (category === "domicilio") return "Domicilio";
  if (category === "servicios") return "Servicios";
  return "Otro";
}

export function isPeriodClosed(reconciliations: BankReconciliation[], accountRef: string, period: string) {
  return reconciliations.some((row) => row.accountRef === accountRef && row.period === period);
}

export function paymentMovementDescription(payment: PaymentRow) {
  const method = payment.method === "nequi" ? "Nequi" : "Efectivo";
  return `Cobro ${payment.ref} · ${payment.type} · ${method}`;
}

export function paymentRefForMovement(row: BankMovement) {
  if (row.paymentRef) return row.paymentRef;
  const match = /Cobro\s+(PG-\d+)/i.exec(row.description);
  return match?.[1] ?? null;
}

export function movementDisplayRef(row: BankMovement) {
  const parts = row.ref.split("-");
  if (parts.length >= 2) return parts.slice(-2).join("-");
  return row.ref.slice(-6);
}

export function syncPaymentsToMovements(
  payments: PaymentRow[],
  movements: BankMovement[],
  accountRef: string,
  period: string,
) {
  const linked = new Set(movements.map((row) => row.paymentRef).filter(Boolean) as string[]);
  const next = [...movements];
  for (const payment of payments) {
    if (linked.has(payment.ref)) continue;
    const payPeriod = periodFromIso(payment.paidDate);
    if (payPeriod !== period) continue;
    next.push({
      ref: nextBankMovementRef(),
      accountRef,
      period,
      description: paymentMovementDescription(payment),
      valueDate: payment.paidDate ?? displayToday(),
      opDate: payment.paidDate ?? displayToday(),
      thirdParty: payment.client,
      debit: 0,
      credit: payment.amount,
      paymentRef: payment.ref,
      inExtract: true,
      reconciled: false,
      manual: false,
    });
  }
  return next;
}

export function miscPaymentMovementDescription(payment: MiscPayment) {
  const method = payment.method === "nequi" ? "Nequi" : "Efectivo";
  return `${payment.label} · Pago varios · ${method}`;
}

/** Enlaza pagos varios como egresos pendientes de conciliar (alta y actualización). */
export function syncMiscPaymentsToMovements(
  miscPayments: MiscPayment[],
  movements: BankMovement[],
) {
  const movementByMisc = new Map(
    movements
      .filter((row) => row.miscPaymentRef)
      .map((row) => [row.miscPaymentRef as string, row]),
  );
  const miscRefs = new Set(miscPayments.map((row) => row.ref));
  let next = movements.filter(
    (row) => !row.miscPaymentRef || miscRefs.has(row.miscPaymentRef),
  );

  for (const payment of miscPayments) {
    const patch = {
      accountRef: payment.bankAccountRef,
      period: periodFromIso(payment.paidDate),
      description: miscPaymentMovementDescription(payment),
      valueDate: payment.paidDate,
      opDate: payment.paidDate,
      thirdParty: payment.label,
      debit: payment.amount,
      credit: 0,
      category: "otro" as BankExpenseCategory,
      miscPaymentRef: payment.ref,
      inExtract: true,
      reconciled: false,
      manual: false,
    };
    const existing = movementByMisc.get(payment.ref);
    if (existing) {
      next = next.map((row) => (row.ref === existing.ref ? { ...row, ...patch } : row));
    } else {
      next.push({
        ref: nextBankMovementRef(),
        ...patch,
      });
    }
  }
  return next;
}

/** Repara enlaces perdidos entre movimientos de egreso y pagos varios existentes. */
export function repairMiscPaymentLinks(
  miscPayments: MiscPayment[],
  movements: BankMovement[],
) {
  return movements.map((row) => {
    if (row.miscPaymentRef || row.debit <= 0) return row;
    const payment = findMiscPaymentForMovement(row, miscPayments);
    if (!payment) return row;
    return { ...row, miscPaymentRef: payment.ref };
  });
}

export function addManualExpense(input: {
  accountRef: string;
  period: string;
  description: string;
  valueDate: string;
  opDate: string;
  thirdParty: string;
  amount: number;
  category: BankExpenseCategory;
}) {
  return {
    ref: nextBankMovementRef(),
    accountRef: input.accountRef,
    period: input.period,
    description: input.description.trim(),
    valueDate: input.valueDate,
    opDate: input.opDate,
    thirdParty: input.thirdParty.trim(),
    debit: input.amount,
    credit: 0,
    category: input.category,
    inExtract: true,
    reconciled: false,
    manual: true,
  } satisfies BankMovement;
}

export function filterMovements(
  movements: BankMovement[],
  accountRef: string,
  period: string,
  query: string,
) {
  const q = query.trim().toLowerCase();
  return movements
    .filter((row) => row.accountRef === accountRef && row.period === period)
    .filter((row) => {
      if (!q) return true;
      const hay = [
        row.ref,
        row.description,
        row.thirdParty,
        row.paymentRef ?? "",
        expenseCategoryLabel(row.category),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const dateCmp = a.valueDate.localeCompare(b.valueDate);
      if (dateCmp !== 0) return dateCmp;
      return a.ref.localeCompare(b.ref);
    });
}

export function withRunningBalance(
  movements: BankMovement[],
  openingBalance: number,
): BankMovementRow[] {
  let balance = openingBalance;
  return movements.map((row) => {
    balance += row.credit - row.debit;
    return { ...row, runningBalance: balance };
  });
}

export function summarizeMovements(rows: BankMovement[]) {
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  return {
    totalDebit,
    totalCredit,
    balance: totalCredit - totalDebit,
    count: rows.length,
  };
}

export function movementsForAccountPeriod(
  movements: BankMovement[],
  accountRef: string,
  period: string,
) {
  return movements.filter((row) => row.accountRef === accountRef && row.period === period);
}

/** Movimientos pendientes de conciliar para una cuenta en el periodo mensual abierto. */
export function pendingMovementsForAccount(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accountRef: string,
  period: string,
) {
  if (isPeriodClosed(reconciliations, accountRef, period)) return [];
  return movementsForAccountPeriod(movements, accountRef, period);
}

export function countPendingForAccount(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accountRef: string,
  period: string,
) {
  return pendingMovementsForAccount(movements, reconciliations, accountRef, period).length;
}

export function listMovementHistory(movements: BankMovement[]) {
  return [...movements].sort((a, b) => {
    const periodCmp = b.period.localeCompare(a.period);
    if (periodCmp !== 0) return periodCmp;
    const dateCmp = b.valueDate.localeCompare(a.valueDate);
    if (dateCmp !== 0) return dateCmp;
    return b.ref.localeCompare(a.ref);
  });
}

/** Todos los movimientos en periodos aún abiertos (sin conciliar), todas las cuentas activas. */
export function listUnreconciledMovements(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accounts: BankAccount[],
) {
  const activeRefs = new Set(accounts.filter((row) => row.active).map((row) => row.ref));
  return movements.filter(
    (row) =>
      activeRefs.has(row.accountRef) &&
      !isPeriodClosed(reconciliations, row.accountRef, row.period),
  );
}

/** Importa cobros pendientes de enlace a la primera cuenta activa, por cada periodo con pagos. */
export function syncAllPaymentsToMovements(
  payments: PaymentRow[],
  movements: BankMovement[],
  accounts: BankAccount[],
) {
  const primary = accounts.find((row) => row.active);
  if (!primary) return movements;

  const periods = new Set<string>();
  for (const payment of payments) {
    const period = periodFromIso(payment.paidDate);
    if (period) periods.add(period);
  }

  let next = movements;
  for (const period of periods) {
    next = syncPaymentsToMovements(payments, next, primary.ref, period);
  }
  return next;
}

/** Movimientos del periodo en cuentas aún abiertas (sin conciliar). */
export function countPendingReconciliation(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accounts: BankAccount[],
  period: string,
) {
  return accounts
    .filter((account) => account.active && !isPeriodClosed(reconciliations, account.ref, period))
    .reduce(
      (sum, account) => sum + movementsForAccountPeriod(movements, account.ref, period).length,
      0,
    );
}

export function reconcilePeriod(
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
  accountRef: string,
  period: string,
  accountOpeningBalance: number,
) {
  const rows = movements.filter((row) => row.accountRef === accountRef && row.period === period);
  const summary = summarizeMovements(rows);
  const openingBalance = openingBalanceForPeriod(
    accountRef,
    period,
    accountOpeningBalance,
    movements,
    reconciliations,
  );
  const closedAt = new Date().toISOString();
  const nextMovements = movements.map((row) =>
    row.accountRef === accountRef && row.period === period
      ? { ...row, reconciled: true, inExtract: true }
      : row,
  );
  const nextReconciliations = [
    ...reconciliations.filter((row) => !(row.accountRef === accountRef && row.period === period)),
    {
      accountRef,
      period: normalizeBankPeriod(period),
      closedAt,
      totalDebit: summary.totalDebit,
      totalCredit: summary.totalCredit,
      balance: openingBalance + summary.balance,
    },
  ];
  return { movements: nextMovements, reconciliations: nextReconciliations, summary };
}

export function voidOpenPeriodMovements(
  movements: BankMovement[],
  accountRef: string,
  period: string,
) {
  return movements.filter(
    (row) => !(row.accountRef === accountRef && row.period === period && row.manual && !row.reconciled),
  );
}

export function listRecentPeriods(reconciliations: BankReconciliation[], accountRef: string, limit = 8) {
  return reconciliations
    .filter((row) => row.accountRef === accountRef)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, limit);
}

function emptyReportYear(fiscalStart: number): BankReportYear {
  const fiscalEnd = fiscalStart + 1;
  return {
    key: `${fiscalStart}-${fiscalEnd}`,
    label: `${fiscalStart}-${fiscalEnd}`,
    months: MONTH_LABELS.map((label, index) => ({
      month: index + 1,
      label,
      gastos: 0,
      ingresos: 0,
    })),
    totalGastos: 0,
    totalIngresos: 0,
    resultado: 0,
  };
}

/** Año fiscal vigente: marzo–febrero (si estamos en ene/feb, el inicio es el año anterior). */
export function currentFiscalStart(reference = new Date()) {
  const year = reference.getFullYear();
  const month = reference.getMonth() + 1;
  return month >= 3 ? year : year - 1;
}

/**
 * Matriz contable por año fiscal.
 * Siempre incluye al menos el año fiscal actual (columna vacía si aún no hay conciliaciones)
 * y agrega columnas nuevas a medida que se concilian periodos de otros años.
 */
export function buildAccountingReport(reconciliations: BankReconciliation[]): BankReportYear[] {
  const yearMap = new Map<string, BankReportYear>();

  const ensureYear = (fiscalStart: number) => {
    const key = `${fiscalStart}-${fiscalStart + 1}`;
    if (!yearMap.has(key)) yearMap.set(key, emptyReportYear(fiscalStart));
    return yearMap.get(key)!;
  };

  ensureYear(currentFiscalStart());

  for (const row of reconciliations) {
    const [yearStr, monthStr] = row.period.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!year || !month) continue;
    const fiscalStart = month >= 3 ? year : year - 1;
    const bucket = ensureYear(fiscalStart);
    const monthEntry = bucket.months[month - 1];
    if (!monthEntry) continue;
    monthEntry.gastos += row.totalDebit;
    monthEntry.ingresos += row.totalCredit;
    bucket.totalGastos += row.totalDebit;
    bucket.totalIngresos += row.totalCredit;
  }

  return [...yearMap.values()]
    .map((year) => ({
      ...year,
      resultado: year.totalIngresos - year.totalGastos,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function formatReportCell(value: number) {
  if (!value) return "";
  return money(value);
}

/** Periodo YYYY-MM a partir de celda del informe (año fiscal + mes calendario 1–12). */
export function periodFromReportCell(fiscalYearKey: string, calendarMonth: number) {
  const fiscalStart = Number(fiscalYearKey.split("-")[0]);
  const year = calendarMonth >= 3 ? fiscalStart : fiscalStart + 1;
  return `${year}-${String(calendarMonth).padStart(2, "0")}`;
}

export type BankLedgerKind = "income" | "expense";

export function listReconciledPeriods(reconciliations: BankReconciliation[]) {
  return [...new Set(reconciliations.map((row) => normalizeBankPeriod(row.period)))].sort((a, b) =>
    b.localeCompare(a),
  );
}

export function listReconciledMovementsByKind(
  movements: BankMovement[],
  kind: BankLedgerKind,
  period?: string,
) {
  const normalizedPeriod = period ? normalizeBankPeriod(period) : null;
  return movements
    .filter((row) => {
      if (!row.reconciled) return false;
      if (kind === "income" ? row.credit <= 0 : row.debit <= 0) return false;
      if (normalizedPeriod && normalizeBankPeriod(row.period) !== normalizedPeriod) return false;
      return true;
    })
    .sort(compareBankMovementsChronological);
}

export function summarizeReconciledMovements(rows: BankMovement[], kind: BankLedgerKind) {
  if (kind === "income") {
    return rows.reduce((sum, row) => sum + row.credit, 0);
  }
  return rows.reduce((sum, row) => sum + row.debit, 0);
}

export function formatBankAmount(value: number) {
  return money(value);
}

export const BANK_ACCOUNTS_SEED: BankAccount[] = [
  {
    ref: "BCA-1",
    name: "Cuenta operativa",
    bankName: "Bancolombia",
    accountNumber: "**** 4821",
    accountType: "corriente",
    currency: "COP",
    country: "Colombia (CO)",
    province: "",
    address: "",
    active: true,
    openingBalance: 2500000,
  },
];

export function seedBankMovements(payments: PaymentRow[]): BankMovement[] {
  const accountRef = "BCA-1";
  const period = currentPeriod();
  const fromPayments = syncPaymentsToMovements(payments, [], accountRef, period);
  const manual: BankMovement[] = [
    {
      ref: nextBankMovementRef(),
      accountRef,
      period,
      description: "Pago nómina cobradores",
      valueDate: displayToday(),
      opDate: displayToday(),
      thirdParty: "Nómina",
      debit: 850000,
      credit: 0,
      category: "nomina",
      inExtract: true,
      reconciled: false,
      manual: true,
    },
    {
      ref: nextBankMovementRef(),
      accountRef,
      period,
      description: "Servicios administrativos",
      valueDate: displayToday(),
      opDate: displayToday(),
      thirdParty: "Administración",
      debit: 120000,
      credit: 0,
      category: "administracion",
      inExtract: true,
      reconciled: false,
      manual: true,
    },
  ];
  return [...fromPayments, ...manual];
}
