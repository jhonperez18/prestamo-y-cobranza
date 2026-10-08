/**
 * El Haber DSB- del registro Banco es evidencia del desembolso.
 * Si un P- lo pisó otro cliente, se rehace la ficha del tercero del movimiento
 * con un código nuevo. No se inventa el capital: sale del Haber.
 */
import type { BankMovement } from "@/lib/bank";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { deletedLoanRefRows, readDeletedIdSet } from "@/lib/deleted-ids";
import { interestFromPct } from "@/lib/finance";
import {
  isoToDisplay,
  previewLoanFlat,
  syncLoan,
  type PayFrequency,
} from "@/lib/loan-preview";
import { rememberDeletedId } from "@/lib/deleted-ids";
import {
  canClientTakeNewLoan,
  isLoanActive,
  isLoanVoided,
  nextLoanCode,
  type ClientRow,
  type LoanRow,
} from "@/lib/mock-data";
import {
  loanBankOutflowCapital,
  loanDisbursementIsoDate,
  loanDisbursementMovementRef,
  loanFundedByBanco,
  loanFundedByNequi,
  loanIsExistingPortfolio,
  markLoanFundedByBanco,
  markLoanFundedByNequi,
} from "@/lib/nequi-pool";
import { isCollectorLiveDevice } from "@/lib/collector-live-window";
import { loanDeletedRow, queueLoansMirror } from "@/lib/supabase/catalog-mirror";

export type RestoreLoansFromDisbursementsInput = {
  loans: LoanRow[];
  movements: BankMovement[];
  clients: ClientRow[];
};

export type RestoreLoansFromDisbursementsResult = {
  loans: LoanRow[];
  movements: BankMovement[];
  created: LoanRow[];
  removed: LoanRow[];
};

function loanCodeNumber(ref: string): number {
  const matched = /^P-(\d+)/i.exec((ref || "").trim());
  return matched ? Number(matched[1]) : Number.POSITIVE_INFINITY;
}

type TwinLoan = Pick<LoanRow, "ref" | "clientRef" | "date" | "capital" | "status" | "fundedBy" | "notes"> & {
  start_date?: string;
};

function twinParts(loan: TwinLoan): string {
  if (isLoanVoided(loan) || !isLoanActive(loan) || loanIsExistingPortfolio(loan)) return "";
  const date = loanDisbursementIsoDate(loan);
  const capital = loanBankOutflowCapital(loan);
  const clientRef = (loan.clientRef || "").trim();
  if (!clientRef || !date || capital <= 0) return "";
  return `${clientRef}|${date}|${capital}`;
}

/** Banco / Nequi: un cliente + un día + un capital = un Haber. El original es el P- más viejo. */
export function digitalDisbursementTwinKey(loan: TwinLoan): string {
  if (!loanFundedByBanco(loan) && !loanFundedByNequi(loan)) return "";
  return twinParts(loan);
}

/** Efectivo de caja: mismo criterio, sin tumbar el catálogo en cada hydrate. */
export function cashDisbursementTwinKey(loan: TwinLoan): string {
  if (loanFundedByBanco(loan) || loanFundedByNequi(loan)) return "";
  return twinParts(loan);
}

export function preferOriginalDigitalLoan<T extends { ref: string }>(current: T, next: T): T {
  return loanCodeNumber(next.ref) < loanCodeNumber(current.ref) ? next : current;
}

function uniqueByTwinKey(loans: LoanRow[], keyOf: (loan: LoanRow) => string): LoanRow[] {
  const keep = new Map<string, LoanRow>();
  for (const loan of loans) {
    const key = keyOf(loan);
    if (!key) continue;
    const current = keep.get(key);
    keep.set(key, current ? preferOriginalDigitalLoan(current, loan) : loan);
  }
  const originals = new Set([...keep.values()].map((row) => row.ref));
  return loans.filter((loan) => {
    const key = keyOf(loan);
    if (!key) return true;
    return originals.has(loan.ref);
  });
}

/** De varias fichas gemelas Banco/Nequi, se queda el P- original (número más bajo). */
export function uniqueDigitalDisbursementLoans(loans: LoanRow[]): LoanRow[] {
  return uniqueByTwinKey(loans, digitalDisbursementTwinKey);
}

/** De varias copias en efectivo, se queda el P- original. No tumba el catálogo. */
export function uniqueCashDisbursementLoans(loans: LoanRow[]): LoanRow[] {
  return uniqueByTwinKey(loans, cashDisbursementTwinKey);
}

export function existingDigitalDisbursementTwin(
  loans: LoanRow[],
  clientRef: string,
  dateIso: string,
  capital: number,
): LoanRow | undefined {
  const ref = (clientRef || "").trim();
  const date = (dateIso || "").trim();
  const amount = Math.trunc(Number(capital) || 0);
  if (!ref || !date || amount <= 0) return undefined;
  const key = `${ref}|${date}|${amount}`;
  return loans.find(
    (loan) => digitalDisbursementTwinKey(loan) === key || cashDisbursementTwinKey(loan) === key,
  );
}

/**
 * Copias del mismo desembolso: se deja el original y las demás salen (tombstone).
 * Así Listado y Banco no muestran P-426 y P-430 a la vez.
 */
export function collapseDuplicateDigitalLoans(loans: LoanRow[]): {
  loans: LoanRow[];
  removed: LoanRow[];
} {
  const originals = new Set(uniqueDigitalDisbursementLoans(loans).map((row) => row.ref));
  const removed: LoanRow[] = [];
  const next: LoanRow[] = [];
  for (const loan of loans) {
    const key = digitalDisbursementTwinKey(loan);
    if (!key || originals.has(loan.ref)) {
      next.push(loan);
      continue;
    }
    removed.push(loan);
  }
  return { loans: next, removed };
}

function nameKey(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clientMatchesThirdParty(client: ClientRow, thirdParty: string) {
  const needle = nameKey(thirdParty);
  if (!needle) return false;
  const full = nameKey(`${client.name} ${client.lastName}`);
  const nick = nameKey(client.name);
  if (full === needle || nick === needle) return true;
  if (full.replace(/ /g, "") === needle.replace(/ /g, "")) return true;
  const needleParts = needle.split(" ").filter(Boolean);
  const fullParts = full.split(" ").filter(Boolean);
  if (needleParts.length >= 2 && fullParts.length >= 2) {
    const hasAll = (left: string[], right: string[]) => left.every((part) => right.includes(part));
    return hasAll(needleParts, fullParts) || hasAll(fullParts, needleParts);
  }
  return false;
}

/** El Haber DSB es de este préstamo, no de otro cliente que heredó el P-. */
export function disbursementBelongsToLoan(
  thirdParty: string | undefined,
  loanClient: string | undefined,
): boolean {
  const a = nameKey(thirdParty || "");
  const b = nameKey(loanClient || "");
  if (!a || !b) return false;
  return a === b || a.replace(/ /g, "") === b.replace(/ /g, "");
}

/** Solo un cliente con ese nombre: dos «Diego» (N y A) no se adivinan. */
function findClientByThirdParty(clients: ClientRow[], thirdParty: string) {
  const matches = clients.filter((row) => clientMatchesThirdParty(row, thirdParty));
  return matches.length === 1 ? matches[0] : undefined;
}

/** DSB-P-425 → P-425 (también DSB-P-425-keep si otro cliente heredó el código). */
export function loanRefFromDisbursementMovement(row: BankMovement): string {
  const raw = String(row.loanDisbursementRef || row.ref || "").trim();
  const matched = /(?:^DSB-)?(P-\d+)(?:-keep)?$/i.exec(raw);
  return matched?.[1] ? `P-${matched[1].replace(/^P-/i, "")}` : "";
}

/** Solo el Haber DSB- de Banco / Nequi. GASL-…-prestamo y CSH- son efectivo de caja. */
function isDisbursementMovement(row: BankMovement) {
  if ((Number(row.credit) || 0) <= 0) return false;
  return /^DSB-/i.test(String(row.ref || "")) || /^DSB-/i.test(String(row.loanDisbursementRef || ""));
}

function fundedFromMovement(row: BankMovement): "banco" | "nequi" {
  const hay = `${row.description || ""} ${row.accountRef || ""}`.toLowerCase();
  return hay.includes("nequi") ? "nequi" : "banco";
}

function valueDateIso(row: BankMovement) {
  return normalizeHistoryDate(row.valueDate || row.opDate || "") || "";
}

function movementClock(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (!/[T\s]\d{1,2}:\d{2}/.test(text) && !text.endsWith("Z")) return "";
  try {
    return new Date(ms).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Bogota",
    });
  } catch (err) {
    console.error("movementClock", err);
    return "";
  }
}

export type OrphanDisbursementOutflow = {
  movementRef: string;
  clientRef: string;
  clientName: string;
  capital: number;
  dateIso: string;
  time: string;
};

/**
 * Haber DSB que no tiene ficha de ese cliente (el P- lo pisó otro o desapareció).
 * El historial Banco lo lista; restoreLoansFromOrphanDisbursements lo convierte en ficha.
 */
export function listOrphanDisbursementOutflows(
  input: RestoreLoansFromDisbursementsInput,
): OrphanDisbursementOutflow[] {
  const rows: OrphanDisbursementOutflow[] = [];
  for (const row of input.movements) {
    if (!isDisbursementMovement(row)) continue;
    const occupiedRef = loanRefFromDisbursementMovement(row);
    if (!occupiedRef) continue;
    const capital = Math.trunc(Number(row.credit) || 0);
    const dateIso = valueDateIso(row);
    if (capital <= 0 || !dateIso) continue;
    const client = findClientByThirdParty(input.clients, row.thirdParty || "");
    if (!client) continue;
    const occupied = input.loans.find((loan) => loan.ref === occupiedRef);
    if (occupied && occupied.clientRef === client.ref) continue;
    const already = input.loans.find(
      (loan) =>
        loan.clientRef === client.ref &&
        isLoanActive(loan) &&
        Number(loan.capital) === capital &&
        loanDisbursementIsoDate(loan) === dateIso,
    );
    if (already) continue;
    rows.push({
      movementRef: row.ref,
      clientRef: client.ref,
      clientName:
        `${client.name} ${client.lastName}`.trim() || (row.thirdParty || "").trim() || occupiedRef,
      capital,
      dateIso,
      time: movementClock(row.opDate) || movementClock(row.valueDate),
    });
  }
  return rows;
}

function movementOwnsLoan(row: BankMovement, loan: LoanRow, clients: ClientRow[]) {
  if (loan.ref !== loanRefFromDisbursementMovement(row)) return false;
  const third = findClientByThirdParty(clients, row.thirdParty || "");
  return Boolean(third && third.ref === loan.clientRef);
}

function siblingTerms(
  orphan: BankMovement,
  movements: BankMovement[],
  loans: LoanRow[],
  clients: ClientRow[],
): LoanRow | null {
  const date = valueDateIso(orphan);
  const capital = Number(orphan.credit) || 0;
  for (const row of movements) {
    if (row.ref === orphan.ref) continue;
    if (!isDisbursementMovement(row)) continue;
    if (valueDateIso(row) !== date) continue;
    if ((Number(row.credit) || 0) !== capital) continue;
    const loanRef = loanRefFromDisbursementMovement(row);
    const loan = loans.find((entry) => entry.ref === loanRef);
    if (!loan || !isLoanActive(loan)) continue;
    if (Number(loan.capital) !== capital) continue;
    if (!movementOwnsLoan(row, loan, clients)) continue;
    return loan;
  }
  return null;
}

function buildRestoredLoan(input: {
  ref: string;
  client: ClientRow;
  capital: number;
  dateIso: string;
  fundedBy: "banco" | "nequi";
  sibling: LoanRow | null;
}): LoanRow {
  const startIso = input.dateIso;
  const sibling = input.sibling;
  const preview =
    sibling && Number(sibling.installment) > 0
      ? null
      : previewLoanFlat({
          capital: input.capital,
          interest: interestFromPct(input.capital, 20),
          startIso,
          frequency: "diario",
          termMonths: 1,
        });
  const frequency = (sibling?.frequency || "diario") as PayFrequency;
  const installment = Number(sibling?.installment) || Number(preview?.installment) || 0;
  const total =
    Number(sibling?.total) || Number(preview?.total) || input.capital;
  const interest = Number(sibling?.interest) || Number(preview?.interest) || 0;
  const notes = sibling?.notes?.includes("Préstamo rápido")
    ? sibling.notes
    : preview
      ? "Préstamo rápido · Diario · 1 mes"
      : "Préstamo";
  const base = syncLoan(
    {
      ref: input.ref,
      clientRef: input.client.ref,
      client: `${input.client.name} ${input.client.lastName}`.trim(),
      date: isoToDisplay(startIso) || startIso,
      due: sibling?.due || (preview ? isoToDisplay(preview.dates[preview.dates.length - 1] || startIso) : ""),
      capital: input.capital,
      paid: 0,
      balance: total,
      status: "Revisar",
      kind: "ok",
      notes,
      rate: sibling?.rate,
      frequency,
      mode: sibling?.mode || "cuota_fija",
      pact: sibling?.pact || "valor",
      days: sibling?.days ?? preview?.days,
      interest,
      total,
      installment,
      schedule: sibling?.schedule ?? preview?.schedule,
      termsPending: true,
    },
    undefined,
  ) as LoanRow;
  const stamped = { ...base, updatedAt: new Date().toISOString() };
  return input.fundedBy === "nequi" ? markLoanFundedByNequi(stamped) : markLoanFundedByBanco(stamped);
}

/**
 * DSB cuyo P- ya es de otro cliente (o desapareció): ficha nueva para el tercero del Haber.
 * Idempotente. No toca el préstamo que se quedó con el código viejo.
 */
export function restoreLoansFromOrphanDisbursements(
  input: RestoreLoansFromDisbursementsInput,
): RestoreLoansFromDisbursementsResult {
  const clients = input.clients;
  let loans = [...input.loans];
  let movements = [...input.movements];
  const created: LoanRow[] = [];
  const deletedRefs = readDeletedIdSet();

  for (const row of input.movements) {
    if (!isDisbursementMovement(row)) continue;
    const occupiedRef = loanRefFromDisbursementMovement(row);
    if (!occupiedRef) continue;
    // Préstamo dado de baja a propósito: su Haber no lo vuelve a crear con otro P-.
    if (deletedRefs.has(occupiedRef) && !loans.some((loan) => loan.ref === occupiedRef)) continue;
    const capital = Number(row.credit) || 0;
    const dateIso = valueDateIso(row);
    if (capital <= 0 || !dateIso) continue;
    const client = findClientByThirdParty(clients, row.thirdParty || "");
    if (!client) continue;

    const occupied = loans.find((loan) => loan.ref === occupiedRef);
    if (occupied && occupied.clientRef === client.ref) continue;

    const already = loans.find(
      (loan) =>
        loan.clientRef === client.ref &&
        isLoanActive(loan) &&
        Number(loan.capital) === capital &&
        loanDisbursementIsoDate(loan) === dateIso,
    );
    if (already || !canClientTakeNewLoan(client.ref, loans)) {
      if (!already) continue;
      const nextDsb = loanDisbursementMovementRef(already.ref);
      if (row.ref === nextDsb) continue;
      movements = movements.map((entry) =>
        entry.ref === row.ref
          ? {
              ...entry,
              ref: nextDsb,
              loanDisbursementRef: nextDsb,
              description: (entry.description || "").replace(occupiedRef, already.ref),
            }
          : entry,
      );
      continue;
    }

    const sibling = siblingTerms(row, input.movements, loans, clients);
    const ref = nextLoanCode([...loans, ...deletedLoanRefRows()]);
    const restored = buildRestoredLoan({
      ref,
      client,
      capital,
      dateIso,
      fundedBy: fundedFromMovement(row),
      sibling,
    });
    loans = [...loans, restored];
    created.push(restored);
    const nextDsb = loanDisbursementMovementRef(ref);
    movements = movements.map((entry) =>
      entry.ref === row.ref
        ? {
            ...entry,
            ref: nextDsb,
            loanDisbursementRef: nextDsb,
            description: (entry.description || "").replace(occupiedRef, ref),
          }
        : entry,
    );
  }

  const collapsed = collapseDuplicateDigitalLoans(loans);
  if (
    typeof window !== "undefined" &&
    collapsed.removed.length > 0 &&
    !isCollectorLiveDevice()
  ) {
    for (const row of collapsed.removed) rememberDeletedId(row.ref);
    queueLoansMirror(collapsed.removed.map((row) => loanDeletedRow(row)));
  }
  return { loans: collapsed.loans, movements, created, removed: collapsed.removed };
}
