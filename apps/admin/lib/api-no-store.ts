import { NextResponse } from "next/server";

/**
 * Respuestas JSON de dinero/ops sin caché CDN.
 * (dynamic/revalidate deben ser literales en cada route.ts — Next no acepta imports.)
 */
export const API_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

export function jsonNoStore(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      ...API_NO_STORE_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}
