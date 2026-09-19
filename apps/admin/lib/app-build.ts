/**
 * Sello de build inyectado en el bundle (`NEXT_PUBLIC_APP_BUILD` vía next.config).
 *
 * Contrato:
 * - Cliente / UI: solo este valor estático (o el que devuelve `/api/ops/build-health`).
 * - Servidor (API): resuelve el SHA vivo en `app/api/ops/build-health/route.ts`.
 * - Nunca importar `child_process` desde este módulo.
 */
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD || "dev";
