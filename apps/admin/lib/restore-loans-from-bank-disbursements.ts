/**
 * El Haber DSB- del registro Banco es evidencia del desembolso, solo para leer.
 * Un préstamo existe si la nube lo tiene: ningún aparato rehace fichas desde Banco
 * ni da de baja «copias» (caso Albornoz 08/10: seis P- para un préstamo y la ficha real borrada).
 */
import type { BankMovement } from "@/lib/bank";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import {
  isLoanActive,
  isLoanVoided,
  type ClientRow,
  type LoanRow,
} from "@/lib/mock-data";
import {
  loanBankOutflowCapital,
  loanDisbursementIsoDate,
  loanFundedByBanco,
  loanFundedByNequi,
  loanIsExistingPortfolio,
} from "@/lib/nequi-pool";

export type OrphanDisbursementInput = {
  loans: LoanRow[];
  movements: BankMovement[];
  clients: ClientRow[];
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

/** Efectivo de caja: mismo criterio. */
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

/** Proyección del registro Banco: un desembolso se cuenta una vez. No toca el catálogo. */
export function uniqueDigitalDisbursementLoans(loans: LoanRow[]): LoanRow[] {
  return uniqueByTwinKey(loans, digitalDisbursementTwinKey);
}

/** Proyección del registro sistema (efectivo): un desembolso se cuenta una vez. */
export function uniqueCashDisbursementLoans(loans: LoanRow[]): LoanRow[] {
  return uniqueByTwinKey(loans, cashDisbursementTwinKey);
}

/** Alta: si ya hay ficha para ese cliente, día y capital, no se crea otra. */
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
 * El historial Banco lo lista para que se vea; la ficha la corrige el dueño en la nube.
 */
export function listOrphanDisbursementOutflows(
  input: OrphanDisbursementInput,
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
