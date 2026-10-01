import { jsonNoStore } from "@/lib/api-no-store";
import { listMonthCloses, writeMonthClose } from "@/lib/supabase/month-close-mirror";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = await listMonthCloses();
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (isVirginWriteLocked()) return jsonNoStore(virginWriteLockPayload());
  try {
    const body = (await request.json()) as { close?: unknown };
    const result = await writeMonthClose(body?.close);
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
