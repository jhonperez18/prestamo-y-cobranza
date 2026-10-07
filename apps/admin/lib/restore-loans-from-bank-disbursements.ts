/**
 * El Haber DSB- del registro Banco es evidencia del desembolso.
 * Si un P- lo pisó otro cliente, se rehace la ficha del tercero del movimiento
 * con un código nuevo. No se inventa el capital: sale del Haber.
 */
import type { BankMovement } from "@/lib/bank";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { deletedLoanRefRows } from "@/lib/deleted-ids";
import { interestFromPct } from "@/lib/finance";
import {
  isoToDisplay,
  previewLoanFlat,
  syncLoan,
  type PayFrequency,
} from "@/lib/loan-preview";
import {
  canClientTakeNewLoan,
  isLoanActive,
  nextLoanCode,
  type ClientRow,
  type LoanRow,
} from "@/lib/mock-data";
import {
  loanDisbursementIsoDate,
  loanDisbursementMovementRef,
  markLoanFundedByBanco,
  markLoanFundedByNequi,
} from "@/lib/nequi-pool";

export type RestoreLoansFromDisbursementsInput = {
  loans: LoanRow[];
  movements: BankMovement[];
  clients: ClientRow[];
};

export type RestoreLoansFromDisbursementsResult = {
  loans: LoanRow[];
  movements: BankMovement[];
  created: LoanRow[];
};

function nameKey(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function clientMatchesThirdParty(client: ClientRow, thirdParty: string) {
  const needle = nameKey(thirdParty);
  if (!needle) return false;
  const full = nameKey(`${client.name} ${client.lastName}`);
  const nick = nameKey(client.name);
  return full === needle || nick === needle;
}

function findClientByThirdParty(clients: ClientRow[], thirdParty: string) {
  return clients.find((row) => clientMatchesThirdParty(row, thirdParty));
}

/** DSB-P-425 → P-425 */
export function loanRefFromDisbursementMovement(row: BankMovement): string {
  const raw = String(row.loanDisbursementRef || row.ref || "").trim();
  const matched = /(?:^DSB-)?(P-\d+)$/i.exec(raw);
  return matched?.[1] ? `P-${matched[1].replace(/^P-/i, "")}` : "";
}

function isDisbursementMovement(row: BankMovement) {
  if ((Number(row.credit) || 0) <= 0) return false;
  if (row.category === "prestamo_ruta") return true;
  const raw = String(row.loanDisbursementRef || row.ref || "");
  return /^DSB-/i.test(raw) || /desembolso/i.test(row.description || "");
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
      updatedAt: new Date().toISOString(),
    },
    undefined,
  ) as LoanRow;
  return input.fundedBy === "nequi" ? markLoanFundedByNequi(base) : markLoanFundedByBanco(base);
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

  for (const row of input.movements) {
    if (!isDisbursementMovement(row)) continue;
    const occupiedRef = loanRefFromDisbursementMovement(row);
    if (!occupiedRef) continue;
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

  return { loans, movements, created };
}
