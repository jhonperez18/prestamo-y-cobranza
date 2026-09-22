import type { ModuleId } from "@/lib/navigation";
import type { AppSession } from "@/lib/auth";

export type FileTab = "ficha" | "activos" | "prestamos" | "evidencias";
export type LoanTab = "ficha" | "prestamos" | "pagos";

export type WorkspaceProps = {
  moduleId: ModuleId;
  viewId: string;
  viewLabel: string;
  moduleLabel: string;
  onGo: (moduleId: ModuleId, viewId?: string) => void;
  onToast: (message?: string) => void;
  onNavBadges?: (badges: Record<string, string | undefined>) => void;
  adminName?: string;
  session: AppSession;
  onSessionChange: (session: AppSession) => void;
  sessionUserRef: string;
  sessionPermissions: string[];
};
