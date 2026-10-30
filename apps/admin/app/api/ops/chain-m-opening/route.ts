import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { readChainMOpening } from "@/lib/server-chain-m-opening";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Inicial M del día = CIE anterior en la base. Solo lee. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectorRef = url.searchParams.get("collectorRef") || "";
  const date = url.searchParams.get("date") || businessTodayIso();
  try {
    const result = await readChainMOpening(collectorRef, date);
    const status = result.ok ? 200 : result.error === "dato_invalido" ? 400 : 500;
    return NextResponse.json(result, {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "chain_m_opening_failed";
    console.error("chain-m-opening", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
