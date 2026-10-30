import { NextResponse } from "next/server";
import { readDigitalPoolBalances } from "@/lib/server-digital-pool-balances";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Totales Banco y Nequi. No baja el archivo. */
export async function GET() {
  try {
    const result = await readDigitalPoolBalances();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "digital_pool_balances_failed";
    console.error("digital-pool-balances", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
