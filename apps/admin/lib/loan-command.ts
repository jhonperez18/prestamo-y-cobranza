/**
 * Orden de préstamo para la nube (Fase 1: el préstamo tiene un solo dueño, la base).
 * El aparato no sube la ficha entera: dice qué quiere hacer y la base lo hace de forma
 * atómica (`create_loan`, `update_loan_terms`, `renew_loan`, `delete_loan`, `set_loan_alerts`).
 * El P- lo asigna la base; hasta que contesta, el préstamo lleva un número pendiente.
 */

export type LoanCommand =
  | { op: "create"; key: string }
  | { op: "update"; termsVersion: number }
  | { op: "renew"; key: string; oldRef: string }
  | { op: "delete"; by: string; key?: string }
  | { op: "alerts" };

export const PENDING_LOAN_REF_PREFIX = "P-pend-";

/** La nube le dio su P- a un préstamo con número pendiente (detalle: `{ from, to }`). */
export const LOAN_REF_RENAMED_EVENT = "nexo-loan-ref-renamed";

/** Sin nada que hacer en la nube (sale de la cola sin aviso). */
export const LOAN_SILENT_SKIPS = ["loan_delete_not_owner", "loan_never_created", "loan_alerts_not_applied"] as const;

const REJECTION_MESSAGES: Record<string, string> = {
  client_has_active_loan: "el cliente ya tiene un préstamo activo",
  version_conflict: "otro aparato lo modificó antes; se cargó la versión de la nube, vuelva a hacer el cambio",
  saldo_cambio: "el saldo cambió en la nube; se cargó el saldo real, vuelva a renovar",
  ya_renovado: "ya estaba renovado",
  prestamo_eliminado: "el préstamo ya fue borrado",
  prestamo_inactivo: "el préstamo ya no está activo",
  sin_saldo: "el préstamo no tiene saldo para renovar",
  notas_renovacion: "renovación mal armada",
  capital_invalido: "capital inválido",
  total_invalido: "el total es menor que el capital",
  fecha_invalida: "falta la fecha",
  cliente_invalido: "falta el cliente",
  falta_quien: "falta quién lo borra",
  clave_requerida: "orden sin clave",
};

/** La nube no aceptó la orden: sale de la cola y se avisa (no se reintenta en silencio). */
export function isLoanRejection(reason: string | null | undefined): boolean {
  return Boolean(reason && reason in REJECTION_MESSAGES);
}

export const LOAN_REJECTION_REASONS = Object.keys(REJECTION_MESSAGES);

export function loanRejectionMessage(reason: string, client: string, cloudRef?: string): string {
  const why = REJECTION_MESSAGES[reason] ?? reason;
  const ref = cloudRef ? ` (${cloudRef})` : "";
  return `Préstamo de ${client || "cliente"} no aplicado en la nube: ${why}${ref}.`;
}

export function isPendingLoanRef(ref: string | null | undefined): boolean {
  return String(ref || "").startsWith(PENDING_LOAN_REF_PREFIX);
}

/** Lo que ve la persona: el P- de la nube o «pendiente de número». */
export function loanRefLabel(ref: string | null | undefined): string {
  return isPendingLoanRef(ref) ? "pendiente de número" : String(ref || "");
}

function randomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Número del préstamo mientras la nube no le da su P- definitivo. */
export function pendingLoanRef(): string {
  return `${PENDING_LOAN_REF_PREFIX}${randomToken().slice(0, 10)}`;
}

/** Clave del alta: el mismo reintento devuelve el mismo P- (nunca dos préstamos). */
export function loanCommandKey(): string {
  return `L-${randomToken()}`;
}

/**
 * Orden que queda en cola si ya había otra para el mismo préstamo.
 * Un alta o renovación pendiente sigue siéndolo (lleva los términos más nuevos);
 * una baja manda sobre todo; modificar manda sobre alertas. Dos modificaciones seguidas
 * parten de la versión de la primera (la nube aún no vio ninguna).
 */
export function mergeLoanCommands(prev: LoanCommand | undefined, next: LoanCommand): LoanCommand {
  if (!prev) return next;
  if (prev.op === "delete") return prev;
  if (next.op === "delete") {
    return prev.op === "create" || prev.op === "renew" ? { ...next, key: prev.key } : next;
  }
  if (prev.op === "create" || prev.op === "renew" || prev.op === "update") return prev;
  return next;
}
