/**
 * Pago tardío: un PG- con dos fechas.
 * - `paidDate`: día en que entra la plata → caja, CIE y banco de ese día.
 * - `lateFor.date`: visita/cuota que cubre (día ya cerrado) → planilla, alertas y mora.
 * El CIE del día cubierto no se toca: su saldo ya quedó sellado.
 */
import type { LatePaymentMark, PaymentRow } from "@/lib/mock-data";

const LATE_CHARGE_PREFIX = "TARDE:";
const FIELD_SEP = "|";
const REST_SEP = "||";

function cleanField(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

/** Persiste la marca en charge_label (columna que ya viaja a la nube). */
export function encodeLateChargeLabel(
  chargeLabel: string | undefined,
  mark: LatePaymentMark | undefined,
): string | undefined {
  const base = (chargeLabel || "").trim();
  if (!mark?.date) return base || undefined;
  const fields = [mark.date, mark.at, mark.by, mark.reason].map((field) => cleanField(field || ""));
  return `${LATE_CHARGE_PREFIX}${fields.join(FIELD_SEP)}${REST_SEP}${base}`;
}

export function parseLateChargeLabel(chargeLabel?: string | null): {
  lateFor?: LatePaymentMark;
  chargeLabel?: string;
} {
  const raw = (chargeLabel || "").trim();
  if (!raw.startsWith(LATE_CHARGE_PREFIX)) return { chargeLabel: raw || undefined };
  const body = raw.slice(LATE_CHARGE_PREFIX.length);
  const cut = body.indexOf(REST_SEP);
  const head = cut >= 0 ? body.slice(0, cut) : body;
  const rest = cut >= 0 ? body.slice(cut + REST_SEP.length).trim() : "";
  const [date = "", at = "", by = "", reason = ""] = head.split(FIELD_SEP).map((p) => p.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { chargeLabel: raw };
  return {
    lateFor: { date, at, by, reason },
    chargeLabel: rest || undefined,
  };
}

/** Día de la visita/cuota que cubre el PG-. Caja y saldos siguen leyendo `paidDate`. */
export function paymentVisitDate(pay: { paidDate?: string; lateFor?: { date?: string } }): string {
  const late = (pay.lateFor?.date || "").trim();
  if (late) return late;
  return (pay.paidDate || "").trim();
}

function isoDayLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Nota visible: qué día cubre, quién, cuándo y por qué. */
export function latePaymentNote(pay: Pick<PaymentRow, "lateFor">): string {
  const mark = pay.lateFor;
  if (!mark?.date) return "";
  const at = mark.at ? ` el ${isoDayLabel(mark.at)}` : "";
  const reason = mark.reason ? ` · ${mark.reason}` : "";
  return `Pago tardío · cubre la cuota del ${isoDayLabel(mark.date)} · registrado por ${mark.by || "—"}${at}${reason}`;
}

/** Etiqueta corta para listas: «Tardío 25/09». */
export function latePaymentTag(pay: Pick<PaymentRow, "lateFor">): string {
  const date = pay.lateFor?.date;
  return date ? `Tardío ${isoDayLabel(date).slice(0, 5)}` : "";
}

export function isLatePayment(pay: Pick<PaymentRow, "lateFor"> | null | undefined): boolean {
  return Boolean(pay?.lateFor?.date?.trim());
}
