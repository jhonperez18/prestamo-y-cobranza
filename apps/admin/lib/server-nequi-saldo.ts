/**
 * Saldo Nequi de la ruta A, leído en el servidor.
 * Cobrado − prestado (capital) − gastos de la cuenta Nequi.
 * El celular no lo rehace con su copia.
 */
import { accountForRole, type BankAccount } from "@/lib/bank";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { downloadCatalogFile } from "@/lib/supabase/catalog-file";

export type NequiSaldoResult =
  | { ok: true; cobrado: number; prestado: number; gastos: number; saldo: number }
  | { ok: false; error: string };

const ANCHOR_FALLBACK = "2026-09-30";
const POOL_MARK = "AJUSTE@POOL-NEQUI:";
const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

function pesos(value: number) {
  return Math.trunc(Number(value) || 0);
}

function isoDate(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

async function everyPage<T>(load: (from: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await load(from);
    if (page.error) throw new Error(page.error.message);
    const batch = page.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

function latestNequiAnchor(
  rows: readonly { close_date?: unknown; movement_refs?: unknown }[],
): { date: string; real: number } {
  let best: { date: string; real: number; at: string } | null = null;
  for (const row of rows) {
    const refs = Array.isArray(row.movement_refs) ? row.movement_refs : [];
    for (const entry of refs) {
      if (typeof entry !== "string" || !entry.startsWith(POOL_MARK)) continue;
      const [calculated, real, at = ""] = entry.slice(POOL_MARK.length).split("|");
      const realNum = Number(real);
      const calcNum = Number(calculated);
      if (!Number.isFinite(realNum) || !Number.isFinite(calcNum)) continue;
      const date = isoDate(row.close_date);
      if (!date) continue;
      if (!best || date > best.date || (date === best.date && at > best.at)) {
        best = { date, real: pesos(realNum), at };
      }
    }
  }
  return best ? { date: best.date, real: best.real } : { date: ANCHOR_FALLBACK, real: 0 };
}

async function nequiAccountRef(): Promise<string> {
  const client = createSupabaseAdminClient();
  if (!client) return "";
  const file = await downloadCatalogFile(client, "app-catalog", "bank-accounts.json");
  if (file.error || !file.data) return "";
  const text = await file.data.text();
  const body = JSON.parse(text) as { accounts?: BankAccount[] };
  return accountForRole(body.accounts ?? [], "nequi")?.ref ?? "";
}

export async function readNequiSaldo(): Promise<NequiSaldoResult> {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  try {
    const closes = await everyPage<{ close_date?: string; movement_refs?: unknown }>((from) =>
      client
        .from("day_closes")
        .select("close_date,movement_refs")
        .gte("close_date", ANCHOR_FALLBACK)
        .range(from, from + PAGE - 1),
    );
    const anchor = latestNequiAnchor(closes);
    const clients = await everyPage<{ ref?: string; route?: string }>((from) =>
      client.from("clients").select("ref,route").range(from, from + PAGE - 1),
    );
    const routeA = new Set(
      clients
        .filter((row) => String(row.route || "").trim().toUpperCase() === "A" && row.ref)
        .map((row) => String(row.ref)),
    );
    const routeList = [...routeA];
    const loans =
      routeList.length === 0
        ? []
        : await everyPage<{
            ref?: string;
            client_ref?: string;
            capital?: number;
            start_date?: string;
            status?: string;
            notes?: string;
          }>((from) =>
            client
              .from("loans")
              .select("ref,client_ref,capital,start_date,status,notes")
              .in("client_ref", routeList)
              .range(from, from + PAGE - 1),
          );
    const loanClient = new Map<string, string>();
    let prestado = 0;
    for (const loan of loans) {
      const ref = String(loan.ref || "");
      const clientRef = String(loan.client_ref || "");
      if (ref) loanClient.set(ref, clientRef);
      if (!routeA.has(clientRef)) continue;
      if (String(loan.status || "") === "Eliminado") continue;
      if (!String(loan.notes || "").includes("[[fb:nequi]]")) continue;
      const start = isoDate(loan.start_date);
      if (!start || start <= anchor.date) continue;
      const capital = pesos(Number(loan.capital) || 0);
      if (capital > 0) prestado += capital;
    }
    const loanRefs = [...loanClient.keys()];
    const payments =
      loanRefs.length === 0
        ? []
        : (
            await Promise.all(
              Array.from({ length: Math.ceil(loanRefs.length / 80) }, (_, index) =>
                everyPage<{
                  amount?: number;
                  loan_ref?: string;
                  method?: string;
                  payment_type?: string;
                  charge_label?: string;
                  paid_date?: string;
                }>((from) =>
                  client
                    .from("payments")
                    .select("amount,loan_ref,method,payment_type,charge_label,paid_date")
                    .in("loan_ref", loanRefs.slice(index * 80, index * 80 + 80))
                    .gt("paid_date", anchor.date)
                    .neq("method", "efectivo")
                    .range(from, from + PAGE - 1),
                ),
              ),
            )
          ).flat();
    let cobrado = 0;
    for (const row of payments) {
      if (String(row.payment_type || "") === "Anulado") continue;
      if (String(row.charge_label || "").startsWith("ANULADO:")) continue;
      if (String(row.method || "").trim().toLowerCase() === "efectivo") continue;
      const paid = isoDate(row.paid_date);
      if (!paid || paid <= anchor.date) continue;
      const clientRef = loanClient.get(String(row.loan_ref || ""));
      if (!clientRef || !routeA.has(clientRef)) continue;
      const amount = pesos(Number(row.amount) || 0);
      if (amount > 0) cobrado += amount;
    }
    const accountRef = await nequiAccountRef();
    const misc = await everyPage<{
      amount?: number;
      bank_account_ref?: string;
      method?: string;
      paid_date?: string;
    }>((from) =>
      client
        .from("misc_payments")
        .select("amount,bank_account_ref,method,paid_date")
        .range(from, from + PAGE - 1),
    );
    let gastos = 0;
    for (const row of misc) {
      const paid = isoDate(row.paid_date);
      if (!paid || paid <= anchor.date) continue;
      const onNequi = accountRef
        ? String(row.bank_account_ref || "") === accountRef
        : String(row.method || "").trim().toLowerCase() === "nequi";
      if (!onNequi) continue;
      const amount = pesos(Number(row.amount) || 0);
      if (amount > 0) gastos += amount;
    }
    const pool = await client.rpc("digital_pool_balances");
    if (pool.error) return { ok: false, error: pool.error.message };
    const body = pool.data as { ok?: boolean; nequi?: number } | null;
    const net = Number(body?.nequi);
    if (!body || body.ok !== true || !Number.isFinite(net)) {
      return { ok: false, error: "sin_nequi" };
    }
    if (pesos(net) !== anchor.real + cobrado - prestado) {
      return { ok: false, error: "nequi_no_cuadra" };
    }
    return {
      ok: true,
      cobrado,
      prestado,
      gastos,
      saldo: anchor.real + cobrado - prestado - gastos,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "nequi_saldo_failed";
    return { ok: false, error: message };
  }
}
