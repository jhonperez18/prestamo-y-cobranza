/**
 * Hoja Ruta del supervisor — solo vista.
 * Misma lógica visual que el cobrador: Renovado (R), P azul, cobro combinado,
 * Fin + Prestar. Renovado aparece aunque aún no haya cobro del crédito nuevo
 * (caso Caña: cobrador muestra R; supervisor no puede dejarlo en S/C).
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { CuotasProgress } from "@/lib/loan-cuotas-progress";
import {
  loanGrantedOnDate,
  loanRenewedOnDate,
  type ReloanState,
} from "@/lib/loan-reloan";
import type { LoanRow, PaymentMethod, PaymentRow } from "@/lib/mock-data";
import {
  paymentMethodInitial,
  paymentMethodLabel,
  paymentMethodToneClass,
} from "@/lib/payment-method";

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
    reloan: { canReloan: false, granted: null, renewed: renewalLoan },
    renewAlert: false,
  };
}

function prestadoLine(
  row: SupervisorRutaSheetRow,
  granted: LoanRow,
  date: string,
): SupervisorRutaSheetRow {
  return {
    ...row,
    key: `prestamo|${row.clientRef}|${granted.ref}|${date}`,
    saldo: Math.trunc(Number(granted.balance) || Number(granted.capital) || 0),
    cuota: 0,
    method: null,
    methodLabel: "P",
    methodToneClass: "is-pay-prestamo",
    methodTitle: "Préstamo nuevo",
    cuotas: emptyCuotas(),
    visitStatus: "omitido",
    awaitingLoan: false,
    paidAmount: 0,
    paidParts: [],
    loanRef: granted.ref,
    reloan: { canReloan: false, granted, renewed: null },
    renewAlert: false,
  };
}

/**
 * Parte / completa las líneas que el cobrador muestra por separado.
 * Renovado y Prestado (P) salen aunque no haya cobro todavía ese día.
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
    // P azul una vez por cliente (préstamo con plata hoy), como «Prestado» del cobrador.
    if (granted && !prestadoDone.has(row.clientRef)) {
      prestadoDone.add(row.clientRef);
      out.push(prestadoLine(row, granted, date));
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
        reloan: stripRenewed(stripGranted(row.reloan)),
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
      for (let i = 0; i < row.paidParts.length; i++) {
        out.push(payPartLine(row, row.paidParts[i], i, i === row.paidParts.length - 1));
      }
      continue;
    }

    // Cuota del renovado / resto: sin volver a marcar Renovado en la misma fila.
    out.push({
      ...row,
      reloan: stripRenewed(row.reloan),
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
      : { canReloan: false, granted: row.reloan.granted, renewed: null },
  };
}

/** Orden dentro del mismo cliente: Renovado → cobro/Fin → P → cuota → Prestar. */
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
  if (row.methodLabel === "P" || row.methodToneClass === "is-pay-prestamo") return 3;
  if (row.reloan.granted && row.paidAmount <= 0) return 3;
  if (row.reloan.canReloan) return 1;
  if (row.paidAmount > 0) return 2;
  return 4;
}
