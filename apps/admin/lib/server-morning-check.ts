/**
 * Revisión de la mañana (6:00 Bogotá, Vercel Cron): deja el camino limpio antes de que
 * salgan las rutas. Sella lo que haya quedado abierto (mismo motor que el corte 23:30)
 * y revisa la nube: hojas pasadas abiertas, días cerrados sin CIE-, Inicial de hoy.
 * No borra nada. El resultado queda en Storage y se ve en Configuración → Aparatos.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";
import { planillaWindowStartIso } from "@/lib/planilla-window";
import { auditChainFromState } from "@/lib/server-chain-audit";
import { loadOperationalStateFromCloud, runServerDayRollover } from "@/lib/server-day-rollover";
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FILE_UPLOAD, downloadCatalogFile } from "@/lib/supabase/catalog-file";
import { listDeviceStatuses } from "@/lib/supabase/device-status-mirror";
import { deviceStorageAlerts } from "@/lib/device-storage-alerts";

export type MorningCheckItem = { label: string; ok: boolean; detail: string };

export type MorningCheckReport = {
  ok: boolean;
  ranAt: string;
  businessDate: string;
  items: MorningCheckItem[];
};

const STORAGE_BUCKET = "app-catalog";
const REPORT_PATH = "morning-check/latest.json";

function moneyLabel(value: number) {
  return Math.round(value).toLocaleString("es-CO");
}

/** Revisión pura sobre el estado de la nube (la prueba automática la usa igual). */
export function evaluateMorningState(
  state: OperationalDayState,
  businessDate: string,
  windowStart: string,
): MorningCheckItem[] {
  const nameOf = (ref: string) => state.collectors.find((row) => row.ref === ref)?.name || ref;
  const days = new Map<string, { collectorRef: string; date: string; open: number }>();
  for (const row of state.assignments) {
    if (!row.dispatched || !row.collectorRef) continue;
    const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    if (!date || date >= businessDate || date < windowStart) continue;
    const key = `${row.collectorRef}::${date}`;
    const day = days.get(key) ?? { collectorRef: row.collectorRef, date, open: 0 };
    if (!row.dayClosedAt) day.open += 1;
    days.set(key, day);
  }
  const sortedDays = [...days.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.collectorRef.localeCompare(b.collectorRef),
  );

  const openSheets = sortedDays.filter((day) => day.open > 0);
  // Desde el primer CIE- del cobrador: los días de antes del cierre en nube no tenían CIE-.
  const firstCie = new Map<string, string>();
  for (const row of state.dayCloses) {
    if (!String(row.ref || "").startsWith("CIE-") || row.provisional) continue;
    const date = normalizeHistoryDate(row.date) || row.date;
    const prev = firstCie.get(row.collectorRef);
    if (date && (!prev || date < prev)) firstCie.set(row.collectorRef, date);
  }
  const missingCie = sortedDays.filter((day) => {
    const since = firstCie.get(day.collectorRef);
    if (!since || day.date < since) return false;
    return !findFullDayCieClose(state.dayCloses, day.collectorRef, day.date);
  });
  const chain = auditChainFromState(state, businessDate);

  return [
    {
      label: "Hojas de días anteriores cerradas",
      ok: openSheets.length === 0,
      detail: openSheets.length
        ? openSheets.map((d) => `${nameOf(d.collectorRef)} ${d.date}: ${d.open} abiertas`).join(" · ")
        : "Todas cerradas",
    },
    {
      label: "Cada día cerrado tiene su CIE",
      ok: missingCie.length === 0,
      detail: missingCie.length
        ? missingCie.map((d) => `${nameOf(d.collectorRef)} ${d.date}`).join(" · ")
        : "Completo",
    },
    {
      label: "Inicial de hoy = cierre de ayer",
      ok: chain.ok,
      detail: chain.rows.length
        ? chain.rows
            .map(
              (row) =>
                `${row.collectorName}: ${row.todayOpening == null ? "—" : moneyLabel(row.todayOpening)}${row.ok ? "" : ` (${row.kind === "independent" ? "Caja" : "CIE"} ${moneyLabel(row.yesterdayCieFloat)})`}`,
            )
            .join(" · ")
        : "Sin cierre ayer (día sin cobro)",
    },
  ];
}

export async function runServerMorningCheck(now = new Date()): Promise<MorningCheckReport> {
  const businessDate = businessTodayIso(now);
  const ranAt = now.toISOString();
  const rollover = await runServerDayRollover(now);
  const sealed = rollover.autoClosed?.length ?? 0;
  const items: MorningCheckItem[] = [
    {
      label: "Sellado de jornadas pendientes",
      ok: rollover.ok,
      detail: rollover.ok
        ? sealed
          ? `Se sellaron ${sealed} jornada(s) que habían quedado abiertas`
          : "No había nada pendiente"
        : `Falló: ${rollover.reason || rollover.errors?.join(" · ") || "error"}`,
    },
  ];

  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) {
    items.push({ label: "Lectura de la nube", ok: false, detail: loaded.error });
  } else {
    items.push(...evaluateMorningState(loaded.state, businessDate, planillaWindowStartIso(now)));
  }
  items.push(await devicesStorageItem(now));
  return { ok: items.every((item) => item.ok), ranAt, businessDate, items };
}

async function devicesStorageItem(now: Date): Promise<MorningCheckItem> {
  const label = "Aparatos guardan lo que bajan";
  const listed = await listDeviceStatuses();
  if (!listed.ok) return { label, ok: false, detail: `No se pudo leer el monitor: ${listed.error}` };
  const alerts = deviceStorageAlerts(listed.devices, now.getTime());
  return {
    label,
    ok: alerts.length === 0,
    detail: alerts.length
      ? alerts.map((a) => `${a.userName} (${a.roleName}, ${a.host}): ${a.reason}`).join(" · ")
      : "Todos con espacio",
  };
}

function storageClient() {
  return createSupabaseAdminClient() ?? createMirrorServerClient();
}

export async function saveMorningCheckReport(report: MorningCheckReport) {
  const supabase = storageClient();
  if (!supabase) return { ok: false as const, error: "supabase_not_configured" };
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(REPORT_PATH, Buffer.from(JSON.stringify(report), "utf8"), CATALOG_FILE_UPLOAD);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function readMorningCheckReport(): Promise<
  { ok: true; report: MorningCheckReport | null } | { ok: false; error: string }
> {
  const supabase = storageClient();
  if (!supabase) return { ok: true, report: null };
  const { data, error } = await downloadCatalogFile(supabase, STORAGE_BUCKET, REPORT_PATH);
  if (error || !data) {
    // Aún no corrió nunca: no es una falla.
    if (/not.?found|404|object/i.test(error?.message || "")) return { ok: true, report: null };
    return { ok: false, error: error?.message || "read_failed" };
  }
  try {
    return { ok: true, report: JSON.parse(await data.text()) as MorningCheckReport };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "parse_failed" };
  }
}
