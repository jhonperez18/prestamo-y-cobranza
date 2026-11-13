import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { readChainMOpening } from "@/lib/server-chain-m-opening";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function parseRefs(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

/** Inicial M del día = CIE anterior en la base. Solo lee. Uno o varios cobradores. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || businessTodayIso();
  const many = parseRefs(url.searchParams.get("collectorRefs"));
  const one = (url.searchParams.get("collectorRef") || "").trim();
  const refs = many.length > 0 ? many : one ? [one] : [];

  try {
    if (refs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "dato_invalido" },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    if (refs.length === 1) {
      const result = await readChainMOpening(refs[0], date);
      const status = result.ok ? 200 : result.error === "dato_invalido" ? 400 : 500;
      return NextResponse.json(result, {
        status,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const rows = await Promise.all(
      refs.map(async (collectorRef) => {
        const result = await readChainMOpening(collectorRef, date);
        return { collectorRef, ...result };
      }),
    );
    return NextResponse.json(
      { ok: true, date, rows },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "chain_m_opening_failed";
    console.error("chain-m-opening", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
