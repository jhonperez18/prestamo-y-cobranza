/**
 * Motor de auto-reparación. Corre `evaluateSystemHealth` tras cada hidratación y, si algo
 * no cuadra, repara sin interrumpir al usuario:
 * - planilla → bajar fresco préstamos + planilla de la nube y rearmar la planilla;
 * - cola → subir lo pendiente ya (sin esperar el backoff).
 * Nunca borra `localStorage` ni colas: ahí viven cobros y cierres aún sin subir.
 * Una misma firma de inconsistencias se repara una sola vez; si persiste, se reporta.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { readDeletedIdSet } from "@/lib/deleted-ids";
import type { OperationalDemoSnapshot } from "@/lib/hydrate-operational-demo";
import { countInvalidMirrorQueueRows } from "@/lib/supabase/mirror-queue";
import {
  evaluateSystemHealth,
  healthIssueSummary,
  type QueueHealthInput,
  type SystemHealthReport,
} from "@/lib/system-health";

export type SelfHealState = {
  /** Inconsistencias que quedan después de reparar (0 = sano). */
  issues: number;
  summary: string;
  /** Ya se intentó reparar esta misma firma y sigue: necesita revisión. */
  persistent: boolean;
};

export type SelfHealDeps = {
  /** Último estado hidratado (se relee después de reparar). */
  readSnapshot: () => OperationalDemoSnapshot | null;
  pendingTotal: () => number;
  /** `false` si no pudo correr (otra bajada en curso): se reintenta en el siguiente ciclo. */
  repairPlanilla: () => Promise<boolean>;
  repairQueue: () => Promise<void>;
  onState: (state: SelfHealState) => void;
};

export function createSelfHealer(deps: SelfHealDeps) {
  let pendingSinceMs: number | null = null;
  let repairedSignature = "";
  let running = false;

  function queueInput(nowMs: number): QueueHealthInput {
    const pendingTotal = deps.pendingTotal();
    if (pendingTotal === 0) pendingSinceMs = null;
    else if (pendingSinceMs === null) pendingSinceMs = nowMs;
    return { pendingTotal, invalidRows: countInvalidMirrorQueueRows(), pendingSinceMs };
  }

  function evaluate(): SystemHealthReport | null {
    const snapshot = deps.readSnapshot();
    if (!snapshot) return null;
    const nowMs = Date.now();
    return evaluateSystemHealth({
      date: businessTodayIso(new Date(nowMs)),
      nowMs,
      clients: snapshot.clients,
      loans: snapshot.loans,
      routes: snapshot.routes,
      collectors: snapshot.collectors,
      assignments: snapshot.assignments,
      dayCloses: snapshot.dayCloses,
      deletedRefs: readDeletedIdSet(),
      queue: queueInput(nowMs),
    });
  }

  function publish(report: SystemHealthReport, persistent: boolean) {
    deps.onState({
      issues: report.issues.length,
      summary: healthIssueSummary(report),
      persistent,
    });
  }

  /** Auto-evaluar → (si hace falta) auto-reparar → re-evaluar. Sin solapes. */
  async function runHealthCycle(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const report = evaluate();
      if (!report) return;
      if (report.ok) {
        repairedSignature = "";
        publish(report, false);
        return;
      }
      if (report.signature === repairedSignature) {
        publish(report, true);
        return;
      }
      const repaired = await autoRepairState(report);
      if (!repaired) {
        publish(report, false);
        return;
      }
      repairedSignature = report.signature;
      const after = evaluate() ?? report;
      publish(after, !after.ok);
    } catch (error) {
      console.error("self-heal", error);
    } finally {
      running = false;
    }
  }

  /** Limpia la proyección (no los datos): baja fresco, rearma planilla, sube cola. */
  async function autoRepairState(report: SystemHealthReport): Promise<boolean> {
    const scopes = new Set(report.issues.map((issue) => issue.scope));
    if (scopes.has("queue")) await deps.repairQueue();
    if (scopes.has("planilla")) return deps.repairPlanilla();
    return true;
  }

  return { runHealthCycle };
}

export type SelfHealer = ReturnType<typeof createSelfHealer>;
