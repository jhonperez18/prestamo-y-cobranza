/**
 * Correo del mensual. Una vez, cuando cierra el último día de cobro del mes
 * y todas las rutas de ese día ya cerraron. Mismo correo que el semanal.
 * No toca caja, Inicial ni CIE.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { informeMonthReady, informePeriodName, informeSnapshotDay } from "@/lib/informe-month-snapshot";
import { buildMonthlySheetsPdf } from "@/lib/monthly-report-pdf";
import { buildMonthlyRouteSheet, monthLabel, type MonthlyRouteName } from "@/lib/monthly-route-sheet";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import { adminEmails, RESEND_URL, resendFromAddress } from "@/lib/server-weekly-report";
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";

const STORAGE_BUCKET = "app-catalog";
const SENT_PATH = "monthly-report-sent.json";
const ROUTES: MonthlyRouteName[] = ["M", "T", "N", "A"];

type SentEntry = { at: string; to: string[]; id: string };
type SentFile = { sent: Record<string, SentEntry> };

export type MonthlyReportSendOptions = {
  now?: Date;
  /** Estado ya leído. Si no viene, se baja la nube. */
  state?: OperationalDayState;
  force?: boolean;
  test?: boolean;
};

export type MonthlyReportSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  day?: string;
  period?: string;
  to?: string[];
  id?: string;
  error?: string;
};

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

async function readSentFile(): Promise<{ ok: true; file: SentFile } | { ok: false; error: string }> {
  const supabase = storageClient();
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await downloadCatalogFile(supabase, STORAGE_BUCKET, SENT_PATH);
  if (error) {
    if (/not found|No such file|404/i.test(error.message)) return { ok: true, file: { sent: {} } };
    return { ok: false, error: error.message };
  }
  try {
    const parsed = JSON.parse(await data.text()) as Partial<SentFile>;
    return { ok: true, file: { sent: parsed.sent ?? {} } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid_sent_file" };
  }
}

async function markSent(period: string, entry: SentEntry) {
  const current = await readSentFile();
  if (!current.ok) return current;
  const supabase = storageClient();
  if (!supabase) return { ok: false as const, error: "supabase_not_configured" };
  const file: SentFile = { sent: { ...current.file.sent, [period]: entry } };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(SENT_PATH, Buffer.from(JSON.stringify(file, null, 2), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

function emailHtml(period: string) {
  const label = monthLabel(period);
  return `<!doctype html>
<html><body style="margin:0;padding:20px;background:#f2f9f9;font-family:Arial,Helvetica,sans-serif;color:#14201b">
<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d5e2db;border-radius:10px;padding:22px">
<h1 style="margin:0;font-size:20px">CA préstamo · Informe mensual</h1>
<p style="margin:6px 0 0;color:#5b7268;font-size:13px">${label}</p>
<p style="margin:16px 0 0;font-size:14px">El mes cerró con todas las rutas. El PDF trae una hoja por ruta: M, T, N y A. Cada tabla va completa en su hoja.</p>
</div>
</body></html>`;
}

export async function sendMonthlyReport(
  options: MonthlyReportSendOptions = {},
): Promise<MonthlyReportSendResult> {
  const now = options.now ?? new Date();
  const today = businessTodayIso(now);
  const day = informeSnapshotDay(today);
  if (!day) return { ok: true, skipped: true, reason: "not_month_end" };
  const period = day.slice(0, 7);

  const record = options.test ? null : await readSentFile();
  if (record && !record.ok) return { ok: false, day, period, error: `sent_record: ${record.error}` };
  if (record?.ok && record.file.sent[period] && !options.force) {
    return { ok: true, skipped: true, reason: "already_sent", day, period, to: record.file.sent[period].to };
  }

  const loaded = options.state ? { ok: true as const, state: options.state } : await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, day, period, error: loaded.error };
  if (!informeMonthReady(loaded.state.assignments, loaded.state.clients, day)) {
    return { ok: true, skipped: true, reason: "not_ready", day, period };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, day, period, error: "resend_not_configured" };
  const recipients = await adminEmails();
  if (!recipients.ok) return { ok: false, day, period, error: recipients.error };
  if (recipients.emails.length === 0) return { ok: false, day, period, error: "no_admin_email" };

  const sheets = ROUTES.map((route) =>
    buildMonthlyRouteSheet({
      route,
      month: period,
      today,
      clients: loaded.state.clients,
      loans: loaded.state.loans,
      payments: loaded.state.payments,
    }),
  );
  const pdf = Buffer.from(buildMonthlySheetsPdf(sheets)).toString("base64");
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resendFromAddress(),
      to: recipients.emails,
      subject: `Informe mensual · ${informePeriodName(period)} ${period.slice(0, 4)}`,
      html: emailHtml(period),
      attachments: [{ filename: `informe-mensual-${period}.pdf`, content: pdf }],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !payload.id) {
    return {
      ok: false,
      day,
      period,
      to: recipients.emails,
      error: `resend_${response.status}: ${payload.message || payload.name || "send_failed"}`,
    };
  }
  if (!options.test) {
    const marked = await markSent(period, { at: now.toISOString(), to: recipients.emails, id: payload.id });
    if (!marked.ok) {
      return {
        ok: false,
        day,
        period,
        to: recipients.emails,
        id: payload.id,
        error: `sent_but_not_recorded: ${marked.error}`,
      };
    }
  }
  return { ok: true, day, period, to: recipients.emails, id: payload.id };
}
