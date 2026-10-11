/**
 * Alarma de las tareas del VPS (sellado 23:35, respaldo 23:45, revisión 6:05): correo a los
 * administradores del Listado (mismos destinatarios que el informe semanal).
 * La pide el VPS (`scripts/vps-tareas/alarma.sh`) cuando una tarea falla o encuentra un problema.
 */
import { adminEmails, RESEND_URL, resendFromAddress } from "@/lib/server-weekly-report";

export type OpsAlarmInput = { task: string; unit: string; host: string; detail: string };

export type OpsAlarmResult =
  | { ok: true; id: string; to: string[] }
  | { ok: false; error: string };

const DETAIL_MAX = 6000;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function alarmHtml(input: OpsAlarmInput, at: string) {
  return [
    `<p><b>${escapeHtml(input.task)}</b> no terminó bien en el servidor (${escapeHtml(input.host)}).</p>`,
    `<p>Hora: ${escapeHtml(at)} (Bogotá) · tarea <code>${escapeHtml(input.unit)}</code></p>`,
    "<p>Últimas líneas del registro:</p>",
    `<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f4;padding:8px">${escapeHtml(input.detail || "(sin registro)")}</pre>`,
    "<p>Los datos del negocio siguen en la nube. Avise al taller para revisar.</p>",
  ].join("\n");
}

export async function sendOpsAlarm(input: OpsAlarmInput, now = new Date()): Promise<OpsAlarmResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "resend_not_configured" };

  const recipients = await adminEmails();
  if (!recipients.ok) return { ok: false, error: recipients.error };
  if (recipients.emails.length === 0) return { ok: false, error: "no_admin_email" };

  const at = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(now);
  const detail = input.detail.slice(-DETAIL_MAX);

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: resendFromAddress(),
        to: recipients.emails,
        subject: `Alarma del servidor: ${input.task}`,
        html: alarmHtml({ ...input, detail }, at),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok || !payload.id) {
      return { ok: false, error: `resend_${response.status}: ${payload.message || payload.name || "send_failed"}` };
    }
    return { ok: true, id: payload.id, to: recipients.emails };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "alarm_send_failed" };
  }
}
