/**
 * Informe del mes, leído en el servidor con las mismas funciones de la pantalla.
 * Préstamos completos: un cobro de octubre puede ser de un préstamo anterior.
 * Solo lectura. No escribe. El botón Préstamo es la suma de esas fichas, cada una con su referencia.
 */
import { sameRoute } from "@/lib/client-route-order";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  informeOwnRouteHistory,
  informeRouteHistory,
  type InformeHistory,
  type InformeRouteHistory,
} from "@/lib/informe-route-days";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, StatusKind } from "@/lib/mock-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mirrorToLoanRow, type LoanMirrorRow } from "@/lib/supabase/catalog-mirror";
import {
  fetchOpsTableSince,
  rowToAssignment,
  rowToDayClose,
  rowToDayExpense,
} from "@/lib/supabase/ops-mirror";
import { fetchPaymentsFromSupabase, mirrorRowToPaymentRow } from "@/lib/supabase/payment-mirror";

const PAGE = 1000;
const MAX_DAYS = 31;
const ROUTE_A = "A";

export type SupervisorInformeResult =
  | { ok: true; from: string; to: string; general: InformeHistory; angelica: InformeRouteHistory }
  | { ok: false; error: string };

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

function daySpan(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

async function everyPage<T>(load: (from: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await load(from);
    if (page.error) throw new Error(page.error.message);
    const batch = page.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

function fail(error: string): SupervisorInformeResult {
  return { ok: false, error };
}

export async function loadSupervisorInforme(from: string, to: string): Promise<SupervisorInformeResult> {
  const span = daySpan(from, to);
  if (span == null || span > MAX_DAYS) return fail("bad_range");
  const db = createSupabaseAdminClient();
  if (!db) return fail("supabase_not_configured");

  const [paymentsT, assignsT, closesT, expensesT] = await Promise.all([
    fetchPaymentsFromSupabase({ fromDate: from, toDate: to }),
    fetchOpsTableSince("daily_assignments", "dispatch_date", from, to),
    fetchOpsTableSince("day_closes", "close_date", from, to),
    fetchOpsTableSince("day_expenses", "expense_date", from, to),
  ]);
  if (!paymentsT.ok || ("skipped" in paymentsT && paymentsT.skipped)) return fail("payments_failed");
  if (!assignsT.ok || ("skipped" in assignsT && assignsT.skipped)) return fail("assignments_failed");
  if (!closesT.ok || ("skipped" in closesT && closesT.skipped)) return fail("closes_failed");
  if (!expensesT.ok || ("skipped" in expensesT && expensesT.skipped)) return fail("expenses_failed");

  type SlimLoan = {
    ref: string;
    client_ref: string;
    client_name: string | null;
    start_date: string | null;
    capital: number | null;
    paid: number | null;
    balance: number | null;
    status: string | null;
    kind: string | null;
    notes: string | null;
    created_at: string | null;
    updated_at: string | null;
  };

  let loans: LoanRow[];
  let clients: ClientRow[];
  let collectors: CollectorRow[];
  let routeRows: { name: string | null; collector_ref: string | null }[];
  try {
    const [loanRows, clientRows, collectorRows, routes] = await Promise.all([
      everyPage<SlimLoan>((start) =>
        db
          .from("loans")
          .select("ref,client_ref,client_name,start_date,capital,paid,balance,status,kind,notes,created_at,updated_at")
          .order("ref", { ascending: true })
          .range(start, start + PAGE - 1),
      ),
      everyPage<{
        ref: string;
        name: string | null;
        last_name: string | null;
        route: string | null;
        status: string | null;
      }>((start) =>
        db
          .from("clients")
          .select("ref,name,last_name,route,status")
          .order("ref", { ascending: true })
          .range(start, start + PAGE - 1),
      ),
      everyPage<{
        ref: string;
        name: string | null;
        zone: string | null;
        phone: string | null;
        active: boolean | null;
        mobile_access: boolean | null;
      }>((start) =>
        db
          .from("collectors")
          .select("ref,name,zone,phone,active,mobile_access")
          .order("ref", { ascending: true })
          .range(start, start + PAGE - 1),
      ),
      everyPage<{ name: string | null; collector_ref: string | null }>((start) =>
        db
          .from("routes")
          .select("name,collector_ref")
          .order("ref", { ascending: true })
          .range(start, start + PAGE - 1),
      ),
    ]);
    loans = loanRows
      .map((row) => {
        const mirror: LoanMirrorRow = {
          ref: row.ref,
          client_ref: row.client_ref,
          client_name: row.client_name || "",
          start_date: row.start_date || "",
          due_date: "",
          capital: Number(row.capital) || 0,
          paid: Number(row.paid) || 0,
          balance: Number(row.balance) || 0,
          status: row.status || "Activo",
          kind: row.kind || "ok",
          notes: row.notes,
          rate: null,
          frequency: null,
          mode: null,
          pact: null,
          days: null,
          interest: null,
          total: null,
          installment: null,
          schedule: null,
          collection_alerts: 0,
          updated_at: row.updated_at || "",
          ...(row.created_at ? { created_at: row.created_at } : {}),
        };
        return mirrorToLoanRow(mirror);
      })
      .filter((row): row is LoanRow => Boolean(row));
    clients = clientRows
      .map((row): ClientRow | null => {
        const ref = (row.ref || "").trim();
        if (!ref) return null;
        return {
          ref,
          alta: "",
          name: row.name || "",
          lastName: row.last_name || "",
          document: "",
          city: "",
          barrio: "",
          route: row.route || "",
          routeOrder: 0,
          email: "",
          phone: "",
          address: "",
          notes: "",
          total: 0,
          pending: 0,
          status: row.status || "Activo",
          kind: "ok" as StatusKind,
        };
      })
      .filter((row): row is ClientRow => Boolean(row));
    collectors = collectorRows
      .map((row): CollectorRow | null => {
        const ref = (row.ref || "").trim();
        if (!ref) return null;
        return {
          ref,
          name: row.name || "",
          zone: row.zone || "",
          phone: row.phone || "",
          active: row.active !== false,
          mobileAccess: row.mobile_access !== false,
        };
      })
      .filter((row): row is CollectorRow => Boolean(row));
    routeRows = routes;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "catalog_failed");
  }

  const payments = paymentsT.rows
    .map(mirrorRowToPaymentRow)
    .filter((row): row is PaymentRow => Boolean(row));
  const assignments = assignsT.rows
    .map(rowToAssignment)
    .filter((row): row is DailyCollectionAssignment => Boolean(row));
  const dayCloses = closesT.rows
    .map(rowToDayClose)
    .filter((row): row is CollectorDayCloseRecord => Boolean(row));
  const dayExpenseDrafts = expensesT.rows
    .map(rowToDayExpense)
    .filter((row): row is CollectorDayExpenseDraft => Boolean(row));

  const onRoutes = new Set(
    routeRows.map((row) => (row.collector_ref || "").trim()).filter(Boolean),
  );
  const collectorRefs = collectors.map((row) => row.ref).filter((ref) => onRoutes.has(ref));
  const angelicaRefs = [
    ...new Set(
      routeRows
        .filter((row) => sameRoute(row.name || "", ROUTE_A))
        .map((row) => (row.collector_ref || "").trim())
        .filter(Boolean),
    ),
  ];

  const src = {
    payments,
    loans,
    clients,
    collectors,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses: [] as [],
    monthCloses: [] as [],
  };

  return {
    ok: true,
    from,
    to,
    general: informeRouteHistory(src, collectorRefs, from, to),
    angelica: informeOwnRouteHistory(src, angelicaRefs, ROUTE_A, from, to),
  };
}
