/**
 * Hoja Ruta del supervisor — solo vista.
 * Misma lógica visual que el cobrador: varias líneas por cliente cuando hoy hubo
 * Renovado, cobro, préstamo nuevo (P), cobro combinado o Fin + Prestar.
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { CuotasProgress } from "@/lib/loan-cuotas-progress";
import type { ReloanState } from "@/lib/loan-reloan";
import type { PaymentMethod } from "@/lib/mock-data";
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

/**
 * Parte una fila enriquecida en las líneas que el cobrador muestra por separado.
 * No inventa visitas: solo desdobla lo que ya está en la fila / reloan / paidParts.
 */
export function expandSupervisorRutaSheetRows(
  rows: SupervisorRutaSheetRow[],
): SupervisorRutaSheetRow[] {
  const out: SupervisorRutaSheetRow[] = [];
  for (const row of rows) {
    const renewed = row.reloan.renewed;
    // Renovado (R) encima del primer cobro del crédito nuevo — igual que el cobrador.
    if (
      renewed &&
      !row.awaitingLoan &&
      row.paidAmount > 0 &&
      row.loanRef &&
      renewed.ref !== row.loanRef
    ) {
      out.push({
        ...row,
        key: `${row.key}|renovado|${renewed.ref}`,
        saldo: Number(renewed.capital) || 0,
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
        loanRef: renewed.ref,
        reloan: { canReloan: false, granted: null, renewed },
        renewAlert: false,
      });
      out.push({
        ...row,
        key: `${row.key}|post-renovado`,
        reloan: stripRenewed(row.reloan),
      });
      continue;
    }

    const granted = row.reloan.granted;
    // P azul + cobro del mismo día del préstamo nuevo → dos líneas.
    if (
      granted &&
      !row.awaitingLoan &&
      row.loanRef === granted.ref &&
      row.paidAmount > 0
    ) {
      out.push({
        ...row,
        key: `${row.key}|prestamo|${granted.ref}`,
        saldo: Number(granted.balance) || Number(granted.capital) || 0,
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
        reloan: { canReloan: false, granted, renewed: null },
        renewAlert: false,
      });
      const payBase = {
        ...row,
        key: `${row.key}|post-prestamo`,
        reloan: stripGranted(stripRenewed(row.reloan)),
      };
      if (payBase.paidParts.length >= 2) {
        for (let i = 0; i < payBase.paidParts.length; i++) {
          const part = payBase.paidParts[i];
          const isLast = i === payBase.paidParts.length - 1;
          out.push(payPartLine(payBase, part, i, isLast));
        }
      } else {
        out.push(payBase);
      }
      continue;
    }

    // Cobro combinado → una línea por medio (B+E, etc.).
    if (row.paidParts.length >= 2 && !row.awaitingLoan) {
      for (let i = 0; i < row.paidParts.length; i++) {
        const part = row.paidParts[i];
        const isLast = i === row.paidParts.length - 1;
        out.push(payPartLine(row, part, i, isLast));
      }
      continue;
    }

    out.push(row);
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
      ? row.reloan
      : { canReloan: false, granted: row.reloan.granted, renewed: null },
  };
}

/** Orden dentro del mismo cliente: Renovado → cobro/Fin → P → Prestar. */
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
  if (row.reloan.granted && row.paidAmount <= 0 && row.methodLabel === "P") return 3;
  if (row.reloan.granted && row.paidAmount <= 0) return 3;
  if (row.reloan.canReloan) return 1;
  if (row.paidAmount > 0) return 2;
  return 4;
}
