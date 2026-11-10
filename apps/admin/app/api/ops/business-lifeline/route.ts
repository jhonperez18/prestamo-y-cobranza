import { NextResponse } from "next/server";
import { runBusinessLifeline } from "@/lib/server-business-lifeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Salvavidas del negocio: descuadres de Caja (CIE ≠ fórmula, Inicial, día vivo).
 * Solo lectura. Misma verdad que verify:prod / chain-audit.
 */
export async function GET() {
  try {
    const report = await runBusinessLifeline(new Date());
    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "business_lifeline_failed";
    console.error("business-lifeline", error);
    return NextResponse.json(
      {
        ok: false,
        businessDate: "",
        checkedAt: new Date().toISOString(),
        alarms: [],
        error: message,
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
