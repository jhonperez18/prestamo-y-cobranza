import { NextResponse } from "next/server";
import { readNequiSaldo } from "@/lib/server-nequi-saldo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Saldo Nequi de la ruta A. Cuatro números. No baja el archivo al celular. */
export async function GET() {
  try {
    const result = await readNequiSaldo();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "nequi_saldo_failed";
    console.error("nequi-saldo", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
