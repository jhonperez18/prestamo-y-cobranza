import { NextResponse } from "next/server";
import { readPoolVisibleSaldo } from "@/lib/server-pool-visible-saldo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 12_000;

/** Saldo Banco/Nequi = rutas − gastos. Tope duro: no deja «…» eterno en el celular. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const toIso = url.searchParams.get("to") || undefined;
    const openIso = url.searchParams.get("open") || undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      readPoolVisibleSaldo({
        toIso: toIso || undefined,
        openIso: openIso || undefined,
      }),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: "pool_visible_timeout" }),
          HARD_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
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
