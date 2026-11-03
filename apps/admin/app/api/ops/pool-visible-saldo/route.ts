import { NextResponse } from "next/server";
import { readPoolVisibleSaldo } from "@/lib/server-pool-visible-saldo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Saldo Banco/Nequi = rutas − gastos (libro completo). No baja el archivo al celular. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const toIso = url.searchParams.get("to") || undefined;
    const openIso = url.searchParams.get("open") || undefined;
    const result = await readPoolVisibleSaldo({
      toIso: toIso || undefined,
      openIso: openIso || undefined,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "pool_visible_saldo_failed";
    console.error("pool-visible-saldo", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
