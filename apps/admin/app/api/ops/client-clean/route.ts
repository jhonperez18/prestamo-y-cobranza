import { NextResponse } from "next/server";
import { bumpClientCleanEpoch, readClientCleanEpoch } from "@/lib/server-client-clean-epoch";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Marca una limpieza de camino para todos los aparatos (cobrador / supervisor).
 * Solo SW, Cache Storage y -bak. No toca cobros ni colas.
 */
export async function POST() {
  try {
    const epoch = await bumpClientCleanEpoch();
    return NextResponse.json(
      { ok: true, cleanEpoch: epoch },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "client_clean_failed";
    console.error("client-clean", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

export async function GET() {
  const cleanEpoch = await readClientCleanEpoch();
  return NextResponse.json(
    { ok: true, cleanEpoch: cleanEpoch || null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
