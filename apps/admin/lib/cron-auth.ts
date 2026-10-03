/** Tareas programadas: Vercel Cron (`x-vercel-cron: 1`) o `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(request: Request) {
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}
