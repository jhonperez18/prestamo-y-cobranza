import { jsonNoStore } from "@/lib/api-no-store";
import { listDeviceStatuses, writeDeviceStatus } from "@/lib/supabase/device-status-mirror";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = await listDeviceStatuses();
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { device?: unknown };
    const result = await writeDeviceStatus(body?.device);
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
