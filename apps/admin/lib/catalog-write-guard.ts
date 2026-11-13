/**
 * Candado anti-cruce de catálogo (rutas / cobradores / usuarios / cuentas banco).
 *
 * Impide que otro taller (ej. localhost:3010 con claves equivocadas) pise
 * el catálogo de producción. Cobros, planilla, gastos y CIE no pasan por aquí.
 *
 * Orígenes permitidos:
 * - https://autoprestamos.org  (celulares + panel en prod)
 * - http://localhost:3000      (taller de ESTE producto)
 * - http://127.0.0.1:3000
 *
 * Sin Origin/Referer: solo si el Host es uno de esos (llamada misma máquina).
 */

export const CATALOG_OPS_MIRROR_KINDS = new Set([
  "route",
  "route_delete",
  "collector",
  "collector_delete",
]);

const ALLOWED_ORIGINS = new Set([
  "https://autoprestamos.org",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const ALLOWED_HOSTS = new Set(["autoprestamos.org", "localhost:3000", "127.0.0.1:3000"]);

export type CatalogWriteGate =
  | { ok: true; via: "origin" | "referer" | "host"; value: string }
  | {
      ok: false;
      error: "catalog_origin_blocked";
      origin: string;
      referer: string;
      host: string;
    };

export function isCatalogOpsMirrorKind(kind: string | undefined | null): boolean {
  return CATALOG_OPS_MIRROR_KINDS.has(String(kind || "").trim());
}

/** Normaliza Origin o URL de Referer a origen canónico (scheme://host[:port]). */
export function canonicalOrigin(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedCatalogOrigin(origin: string | null | undefined): boolean {
  const clean = String(origin || "").trim().replace(/\/$/, "");
  if (!clean) return false;
  return ALLOWED_ORIGINS.has(clean);
}

export function isAllowedCatalogHost(host: string | null | undefined): boolean {
  const clean = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!clean) return false;
  // Prod puede llegar como autoprestamos.org:443 en algunos proxies.
  if (clean === "autoprestamos.org" || clean.startsWith("autoprestamos.org:")) {
    return true;
  }
  return ALLOWED_HOSTS.has(clean);
}

/**
 * Decide si esta petición puede mutar catálogo.
 * Función pura sobre headers (fácil de candar en script).
 */
export function evaluateCatalogWriteGate(headers: {
  origin?: string | null;
  referer?: string | null;
  host?: string | null;
}): CatalogWriteGate {
  const originHeader = String(headers.origin || "").trim();
  const refererHeader = String(headers.referer || "").trim();
  const hostHeader = String(headers.host || "").trim();

  const fromOrigin = canonicalOrigin(originHeader);
  if (fromOrigin) {
    if (isAllowedCatalogOrigin(fromOrigin)) {
      return { ok: true, via: "origin", value: fromOrigin };
    }
    return {
      ok: false,
      error: "catalog_origin_blocked",
      origin: fromOrigin,
      referer: refererHeader,
      host: hostHeader,
    };
  }

  const fromReferer = canonicalOrigin(refererHeader);
  if (fromReferer) {
    if (isAllowedCatalogOrigin(fromReferer)) {
      return { ok: true, via: "referer", value: fromReferer };
    }
    return {
      ok: false,
      error: "catalog_origin_blocked",
      origin: "",
      referer: fromReferer,
      host: hostHeader,
    };
  }

  // Sin Origin/Referer: solo Host del taller o prod (scripts misma máquina).
  if (isAllowedCatalogHost(hostHeader)) {
    return { ok: true, via: "host", value: hostHeader };
  }

  return {
    ok: false,
    error: "catalog_origin_blocked",
    origin: originHeader,
    referer: refererHeader,
    host: hostHeader,
  };
}

export function catalogWriteGateFromRequest(request: Request): CatalogWriteGate {
  return evaluateCatalogWriteGate({
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    host: request.headers.get("host"),
  });
}

export function catalogOriginBlockedPayload(gate: Extract<CatalogWriteGate, { ok: false }>) {
  return {
    ok: false as const,
    error: gate.error,
    message:
      "Catálogo bloqueado: este origen no puede cambiar rutas, usuarios ni cuentas. Solo autoprestamos.org o localhost:3000.",
    origin: gate.origin,
    referer: gate.referer,
    host: gate.host,
  };
}
