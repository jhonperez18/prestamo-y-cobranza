import { NextResponse } from "next/server";
import { runRouteCashBook } from "@/lib/server-route-cash-book";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Libro de caja de A / N desde la nube completa (solo montos por día; no escribe). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectorRef = url.searchParams.get("collectorRef") || "";
  const route = url.searchParams.get("route") || "";
  try {
    const result = await runRouteCashBook(collectorRef, route);
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "route_cash_book_failed";
    console.error("route-cash-book", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
