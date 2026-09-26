import { NextResponse } from "next/server";
import { runServerChainAudit } from "@/lib/server-chain-audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Regla de inicio contra Supabase (para verify:prod): Inicial M de hoy = CIE de ayer.
 * Solo montos por cobrador; sin datos de clientes.
 */
export async function GET() {
  try {
    const result = await runServerChainAudit(new Date());
    return NextResponse.json(result, {
      status: result.error ? 500 : 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "chain_audit_failed";
    console.error("chain-audit", error);
    return NextResponse.json(
      { ok: false, error: message, rows: [] },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
