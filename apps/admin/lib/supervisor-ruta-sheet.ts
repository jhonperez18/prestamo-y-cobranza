/**
 * Hoja Ruta del supervisor — solo vista.
 * Misma lógica visual que el cobrador: Renovado (R), Prestado con letra E/B/N,
 * cobro combinado, Fin + Prestar. Tras Prestado no se pinta el Prestar omitido
 * (S/C). Cuota del P- nuevo solo si la 1.ª cuota es hoy.
 */
import {
  loanIsCollectibleOn,
  type DailyCollectionAssignment,
} from "@/lib/daily-collection-plan";
import type { CuotasProgress } from "@/lib/loan-cuotas-progress";
import {
  loanGrantedOnDate,
  loanRenewedOnDate,
  loanSettledOnDate,
  type ReloanState,
} from "@/lib/loan-reloan";
import type { LoanRow, PaymentMethod, PaymentRow } from "@/lib/mock-data";
import {
  loanDisbursementSource,
  loanFundLetter,
  loanFundLetterTitle,
} from "@/lib/nequi-pool";
import {
  paymentMethodInitial,
  paymentMethodLabel,
  paymentMethodToneClass,
} from "@/lib/payment-method";

function prestadoFundMethod(loan: LoanRow): PaymentMethod {
  const source = loanDisbursementSource(loan);
  if (source === "nequi") return "nequi";
  if (source === "banco") return "banco";
  return "efectivo";
}

type VisitStatus = NonNullable<DailyCollectionAssignment["visitStatus"]>;

export type SupervisorRutaSheetRow = {
  key: string;
  index: number;
  clientName: string;
  saldo: number;
  cuota: number;
  method: PaymentMethod | null;
  methodLabel: string | null;
  methodToneClass: string;
  methodTitle: string | undefined;
  cuotas: CuotasProgress;
  visitStatus: VisitStatus;
  awaitingLoan: boolean;
  paidAmount: number;
  paidParts: Array<{ method: PaymentMethod; amount: number }>;
  route: string;
  clientRef: string;
  loanRef: string;
  reloan: ReloanState;
  renewAlert: boolean;
};

function emptyCuotas(title = ""): CuotasProgress {
  return {
    label: title ? "0/0" : "",
    intensity: 0,
    title,
    expected: title ? 1 : 0,
    paid: 0,
    total: 0,
    covered: 0,
    paidTotal: 0,
    installment: 0,
    lagDays: 0,
  };
}

function stripRenewed(reloan: ReloanState): ReloanState {
  return { ...reloan, renewed: null };
}

function stripGranted(reloan: ReloanState): ReloanState {
  return { ...reloan, granted: null };
}

/**
 * Cobro que liquidó el crédito hoy → Fin (antes del 0), aunque debajo haya Prestado.
 * Misma bandera `finishedToday` que el Recaudo del cobrador. El P azul va aparte.
 */
function reloanForPayLine(
  row: SupervisorRutaSheetRow,
  loans: LoanRow[],
  payments: PaymentRow[],
  date: string,
  granted: LoanRow | null,
): ReloanState {
  const loan = row.loanRef ? loans.find((entry) => entry.ref === row.loanRef) ?? null : null;
  const settledOld =
    Boolean(loan) &&
    row.paidAmount > 0 &&
    !row.awaitingLoan &&
    (!granted || loan!.ref !== granted.ref) &&
    loanSettledOnDate(loan, payments, date);
  return {
    finishedToday: settledOld || row.reloan.finishedToday,
    canReloan: settledOld && !granted ? true : row.reloan.canReloan && !granted,
    granted: null,
    renewed: null,
  };
}

function renovadoLine(
  row: SupervisorRutaSheetRow,
  renewalLoan: LoanRow,
  date: string,
): SupervisorRutaSheetRow {
  return {
    ...row,
    key: `renovado|${row.clientRef}|${renewalLoan.ref}|${date}`,
    saldo: Math.trunc(Number(renewalLoan.capital) || 0),
    cuota: 0,
    method: null,
    methodLabel: "R",
    methodToneClass: "is-pay-renovado",
    methodTitle: "Renovado: sin plata",
    cuotas: emptyCuotas("Renovado hoy · al día (sin mora)"),
    visitStatus: "omitido",
    awaitingLoan: false,
    paidAmount: 0,
    paidParts: [],
    loanRef: renewalLoan.ref,
    reloan: { finishedToday: false, canReloan: false, granted: null, renewed: renewalLoan },
    renewAlert: false,
  };
}

function prestadoLine(
  row: SupervisorRutaSheetRow,
  granted: LoanRow,
  date: string,
): SupervisorRutaSheetRow {
  const method = prestadoFundMethod(granted);
  const letter = loanFundLetter(granted);
  return {
    ...row,
    key: `prestamo|${row.clientRef}|${granted.ref}|${date}`,
    saldo: Math.trunc(Number(granted.balance) || Number(granted.capital) || 0),
    cuota: 0,
    method,
    methodLabel: letter,
    methodToneClass: paymentMethodToneClass(method),
    methodTitle: `Préstamo nuevo · ${loanFundLetterTitle(letter)}`,
    cuotas: emptyCuotas(),
    visitStatus: "omitido",
    awaitingLoan: false,
    paidAmount: 0,
    paidParts: [],
    loanRef: granted.ref,
    reloan: { finishedToday: false, canReloan: false, granted, renewed: null },
    renewAlert: false,
  };
}

/**
 * Parte / completa las líneas que el cobrador muestra por separado.
 * Renovado y Prestado (letra E/B/N) salen aunque no haya cobro todavía ese día.
 */
export function expandSupervisorRutaSheetRows(
  rows: SupervisorRutaSheetRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  date: string,
): SupervisorRutaSheetRow[] {
  const out: SupervisorRutaSheetRow[] = [];
  const renovadoDone = new Set<string>();
  const prestadoDone = new Set<string>();

  for (const row of rows) {
    const renewalLoan = loanRenewedOnDate(row.clientRef, loans, date);
    if (renewalLoan && !renovadoDone.has(row.clientRef)) {
      renovadoDone.add(row.clientRef);
      out.push(renovadoLine(row, renewalLoan, date));
    }

    // Visita «Renovado hoy» del crédito viejo: ya quedó la línea R; no duplicar.
    if (
      renewalLoan &&
      row.visitStatus === "omitido" &&
      row.loanRef &&
      row.loanRef !== renewalLoan.ref &&
      row.paidAmount <= 0 &&
      !row.awaitingLoan
    ) {
      continue;
    }

    const granted = loanGrantedOnDate(row.clientRef, loans, payments, date);
    // Prestado (letra E/B/N) una vez por cliente, como el Recaudo del cobrador.
    if (granted && !prestadoDone.has(row.clientRef)) {
      prestadoDone.add(row.clientRef);
      out.push(prestadoLine(row, granted, date));
    }

    /**
     * Ya hubo Prestado hoy:
     * - Prestar omitido (S/C) sobra: engaña («no pagó»).
     * - Cuota del P- nuevo si la 1.ª NO es hoy: también sobra.
     * - Si la 1.ª cuota ES hoy: la visita de cobro sí entra.
     */
    if (granted && row.paidAmount <= 0) {
      if (row.awaitingLoan) continue;
      if (row.loanRef === granted.ref && !loanIsCollectibleOn(granted, date)) {
        continue;
      }
    }

    const renewed = row.reloan.renewed;
    // Renovado encima del cobro del crédito nuevo (si reloan lo traía distinto).
    if (
      renewed &&
      !row.awaitingLoan &&
      row.paidAmount > 0 &&
      row.loanRef &&
      renewed.ref !== row.loanRef &&
      !renovadoDone.has(row.clientRef)
    ) {
      renovadoDone.add(row.clientRef);
      out.push(renovadoLine(row, renewed, date));
      out.push({
        ...row,
        key: `${row.key}|post-renovado`,
        reloan: reloanForPayLine(row, loans, payments, date, granted),
      });
      continue;
    }

    // Cobro del préstamo nuevo el mismo día → ya hay P arriba; el cobro debajo.
    if (
      granted &&
      !row.awaitingLoan &&
      row.loanRef === granted.ref &&
      row.paidAmount > 0
    ) {
      const payBase = {
        ...row,
        key: `${row.key}|post-prestamo`,
        reloan: stripGranted(stripRenewed(row.reloan)),
      };
      if (payBase.paidParts.length >= 2) {
        for (let i = 0; i < payBase.paidParts.length; i++) {
          out.push(payPartLine(payBase, payBase.paidParts[i], i, i === payBase.paidParts.length - 1));
        }
      } else {
        out.push(payBase);
      }
      continue;
    }

    if (row.paidParts.length >= 2 && !row.awaitingLoan) {
      const payBase = {
        ...row,
        reloan: reloanForPayLine(row, loans, payments, date, granted),
      };
      for (let i = 0; i < payBase.paidParts.length; i++) {
        out.push(
          payPartLine(payBase, payBase.paidParts[i], i, i === payBase.paidParts.length - 1),
        );
      }
      continue;
    }

    // Cobro / cuota: Fin si liquidó hoy; sin Renovado ni P en la misma fila.
    out.push({
      ...row,
      reloan: row.paidAmount > 0
        ? reloanForPayLine(row, loans, payments, date, granted)
        : stripGranted(stripRenewed(row.reloan)),
    });
  }
  return out;
}

function payPartLine(
  row: SupervisorRutaSheetRow,
  part: { method: PaymentMethod; amount: number },
  partIndex: number,
  keepFin: boolean,
): SupervisorRutaSheetRow {
  return {
    ...row,
    key: `${row.key}|part|${part.method}|${partIndex}`,
    paidAmount: part.amount,
    paidParts: [],
    method: part.method,
    methodLabel: paymentMethodInitial(part.method),
    methodToneClass: paymentMethodToneClass(part.method),
    methodTitle: `${paymentMethodLabel(part.method)} · ${part.amount}`,
    reloan: keepFin
      ? stripRenewed(row.reloan)
      : {
          finishedToday: false,
          canReloan: false,
          granted: row.reloan.granted,
          renewed: null,
        },
  };
}

/** Orden dentro del mismo cliente: Renovado → cobro/Fin → Prestado → cuota → Prestar. */
export function compareRutaSheetRows(a: SupervisorRutaSheetRow, b: SupervisorRutaSheetRow): number {
  const route = a.route.localeCompare(b.route, "es");
  if (route) return route;
  if (a.index !== b.index) return a.index - b.index;
  if (a.clientRef !== b.clientRef) return a.clientName.localeCompare(b.clientName, "es");
  return rutaLineRank(a) - rutaLineRank(b);
}

function rutaLineRank(row: SupervisorRutaSheetRow): number {
  if (row.reloan.renewed && row.paidAmount <= 0) return 0;
  if (row.methodLabel === "R" || row.methodToneClass === "is-pay-renovado") return 0;
  if (row.awaitingLoan) return 5;
  // Prestado: letra E/B/N (ya no P); el estado a la derecha dice «Prestado».
  if (row.reloan.granted && row.paidAmount <= 0) return 3;
  if (row.key.startsWith("prestamo|")) return 3;
  // Fin (liquidó) va antes del Prestado, con el 0 del crédito cerrado.
  if (row.reloan.finishedToday) return 1;
  if (row.paidAmount > 0) return 2;
  return 4;
}
