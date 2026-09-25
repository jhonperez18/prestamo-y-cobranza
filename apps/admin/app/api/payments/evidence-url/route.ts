import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createMirrorServerClient } from "@/lib/supabase/admin";
import { PAYMENT_EVIDENCE_BUCKET } from "@/lib/supabase/payment-evidence-storage";

/**
 * URL firmada corta para ver firma/comprobante en Cobranza.
 * Nunca devuelve Base64: el binario vive en el bucket `evidence`.
 */
export async function GET(request: Request) {
  try {
    const path = new URL(request.url).searchParams.get("path")?.trim() || "";
    if (!path || path.startsWith("data:") || path.includes("..")) {
      return NextResponse.json({ ok: false, error: "invalid_path" }, { status: 400 });
    }
    if (!path.startsWith("payments/")) {
      return NextResponse.json({ ok: false, error: "invalid_path" }, { status: 400 });
    }

    const client = createSupabaseAdminClient() ?? createMirrorServerClient();
    if (!client) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }

    const { data, error } = await client.storage
      .from(PAYMENT_EVIDENCE_BUCKET)
      .createSignedUrl(path, 60 * 30);

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: error?.message || "signed_url_failed" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, url: data.signedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
