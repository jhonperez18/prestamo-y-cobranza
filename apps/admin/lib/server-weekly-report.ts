/**
 * Envío del informe semanal por correo (Resend). Lo dispara el cron de cierre (23:30 / 00:05 Bogotá)
 * después de sellar la jornada, solo el día que cierra un corte (sábado hábil o fin de mes).
 *
 * Destinatarios = usuarios activos del Listado con rol administrador (`ADMIN_ROLE_REF`) y correo.
 * Registro de enviados: Storage `app-catalog/weekly-report-sent.json` (un corte = un correo).
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { ADMIN_ROLE_REF } from "@/lib/mock-data";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import type { MiscPayment } from "@/lib/misc-payments";
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";
import { fetchUsersFromSupabase } from "@/lib/supabase/user-mirror";
import {
  buildWeeklyReport,
  weeklyCutoffClosedNear,
  weeklyRangeForCutoff,
  type WeeklyReportScope,
  type WeeklyReportSources,
} from "@/lib/weekly-report";
import { weeklyReportEmailHtml, weeklyReportEmailSubject } from "@/lib/weekly-report-email";
import { buildWeeklyReportPdf } from "@/lib/weekly-report-pdf";

const STORAGE_BUCKET = "app-catalog";
const SENT_PATH = "weekly-report-sent.json";
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "CA préstamo <onboarding@resend.dev>";
const SCOPES: WeeklyReportScope[] = ["mtn", "a"];

type SentEntry = { at: string; to: string[]; id: string };
type SentFile = { sent: Record<string, SentEntry> };

export type WeeklyReportSendOptions = {
  now?: Date;
  /** Corte a enviar (YYYY-MM-DD). Sin esto: el corte que cerró hoy o ayer. */
  cutoff?: string;
  /** Reenviar aunque ya conste enviado. */
  force?: boolean;
  /** Prueba: asunto «[Prueba]» y no se marca como enviado. */
  test?: boolean;
  /** URL absoluta del logo para el encabezado del PDF. */
  logoUrl?: string;
};

export type WeeklyReportSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  cutoff?: string;
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

async function markSent(cutoff: string, entry: SentEntry) {
  const current = await readSentFile();
  if (!current.ok) return current;
  const supabase = storageClient();
  if (!supabase) return { ok: false as const, error: "supabase_not_configured" };
  const file: SentFile = { sent: { ...current.file.sent, [cutoff]: entry } };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(SENT_PATH, Buffer.from(JSON.stringify(file, null, 2), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

async function adminEmails(): Promise<{ ok: true; emails: string[] } | { ok: false; error: string }> {
  const users = await fetchUsersFromSupabase();
  if (!users.ok) return { ok: false, error: users.error || "users_fetch_failed" };
  const emails = users.rows
    .filter((row) => row.active && row.role_ref === ADMIN_ROLE_REF)
    .map((row) => (row.email || "").trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  return { ok: true, emails: [...new Set(emails)] };
}

async function loadLogo(url: string | undefined) {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.error("weekly-report logo", response.status);
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (err) {
    console.error("weekly-report logo", err);
    return null;
  }
}

function generatedLabel(now: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(now);
}

export async function sendWeeklyReport(options: WeeklyReportSendOptions = {}): Promise<WeeklyReportSendResult> {
  const now = options.now ?? new Date();
  const today = businessTodayIso(now);
  const cutoff = options.cutoff ?? weeklyCutoffClosedNear(today, now);
  if (!cutoff) return { ok: true, skipped: true, reason: "not_cutoff_day" };

  const record = options.test ? null : await readSentFile();
  if (record && !record.ok) return { ok: false, cutoff, error: `sent_record: ${record.error}` };
  if (record?.ok && record.file.sent[cutoff] && !options.force) {
    return { ok: true, skipped: true, reason: "already_sent", cutoff, to: record.file.sent[cutoff].to };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, cutoff, error: "resend_not_configured" };

  const recipients = await adminEmails();
  if (!recipients.ok) return { ok: false, cutoff, error: recipients.error };
  if (recipients.emails.length === 0) return { ok: false, cutoff, error: "no_admin_email" };

  const [loaded, miscT, accountsT] = await Promise.all([
    loadOperationalStateFromCloud(),
    fetchOpsTable("misc_payments"),
    fetchBankAccountsFromSupabase(),
  ]);
  if (!loaded.ok) return { ok: false, cutoff, error: loaded.error };
  if (!miscT.ok) return { ok: false, cutoff, error: `misc_payments: ${"error" in miscT ? miscT.error : "fetch_failed"}` };
  if (!accountsT.ok) return { ok: false, cutoff, error: `bank_accounts: ${accountsT.error}` };
  const { state } = loaded;
  const sources: WeeklyReportSources = {
    ...state,
    planillaCashCloses: state.planillaCashCloses ?? [],
    monthCloses: state.monthCloses ?? [],
    miscPayments: (miscT.rows ?? []).map(rowToMisc).filter((row): row is MiscPayment => Boolean(row)),
    bankAccounts: accountsT.accounts,
  };
  const range = weeklyRangeForCutoff(cutoff, today);
  const reports = SCOPES.map((scope) => buildWeeklyReport(sources, scope, range, today));

  const logoDataUrl = await loadLogo(options.logoUrl);
  const label = generatedLabel(now);
  const attachments = reports.map((report) => ({
    filename: `informe-semanal-${report.scope === "a" ? "A" : "MTN"}-${cutoff}.pdf`,
    content: Buffer.from(buildWeeklyReportPdf(report, { logoDataUrl, generatedLabel: label })).toString("base64"),
  }));

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.WEEKLY_REPORT_FROM?.trim() || DEFAULT_FROM,
      to: recipients.emails,
      subject: weeklyReportEmailSubject(reports, Boolean(options.test)),
      html: weeklyReportEmailHtml(reports),
      attachments,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !payload.id) {
    return {
      ok: false,
      cutoff,
      to: recipients.emails,
      error: `resend_${response.status}: ${payload.message || payload.name || "send_failed"}`,
    };
  }

  if (!options.test) {
    const marked = await markSent(cutoff, { at: now.toISOString(), to: recipients.emails, id: payload.id });
    if (!marked.ok) {
      return { ok: false, cutoff, to: recipients.emails, id: payload.id, error: `sent_but_not_recorded: ${marked.error}` };
    }
  }
  return { ok: true, cutoff, to: recipients.emails, id: payload.id };
}
