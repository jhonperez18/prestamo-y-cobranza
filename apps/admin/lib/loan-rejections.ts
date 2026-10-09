/**
 * Órdenes de préstamo que la nube no aceptó (cliente con otro activo, versión vieja…).
 * Quedan anotadas en el aparato y se avisan en pantalla: nunca se pierden en silencio.
 */
import { readDemoJson, writeDemoJson } from "@/lib/demo-persist";
import { loanRejectionMessage } from "@/lib/loan-command";

export const LOAN_REJECTED_EVENT = "nexo-loan-command-rejected";
const LOAN_REJECTIONS_KEY = "nexo-demo-loan-rejections";
const KEEP = 30;

export type LoanRejection = {
  ref: string;
  client: string;
  reason: string;
  cloudRef?: string;
  message: string;
  at: string;
};

export function readLoanRejections(): LoanRejection[] {
  return readDemoJson<LoanRejection[]>(LOAN_REJECTIONS_KEY, []);
}

function recordRejection(entry: LoanRejection): LoanRejection {
  console.error("[rechazo-nube]", entry.message, entry.ref);
  if (typeof window === "undefined") return entry;
  writeDemoJson(LOAN_REJECTIONS_KEY, [entry, ...readLoanRejections()].slice(0, KEEP));
  window.dispatchEvent(new CustomEvent(LOAN_REJECTED_EVENT, { detail: entry }));
  return entry;
}

export function reportLoanRejection(input: Omit<LoanRejection, "message" | "at">): LoanRejection {
  return recordRejection({
    ...input,
    message: loanRejectionMessage(input.reason, input.client, input.cloudRef),
    at: new Date().toISOString(),
  });
}

/** Cobro que la nube no aceptó: ya salió de la caja del aparato; el cobrador lo ve en pantalla. */
export function reportPaymentRejection(input: Omit<LoanRejection, "at">): LoanRejection {
  return recordRejection({ ...input, at: new Date().toISOString() });
}
