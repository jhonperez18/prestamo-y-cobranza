#!/bin/bash
# Una noche (24/10/2026). Publica el codigo ya subido despues del sellado.
# No toca cobros, caja, Inicial, CIE ni la hoja. Si el dia sigue abierto, no reinicia.
set -u
LOG=/var/log/autoprestamos-reparacion.log
exec >>"$LOG" 2>&1
echo "=== $(date -Is) reparacion: espera a que el sellado cierre el dia ==="

DAY=$(node --input-type=module -e "process.stdout.write(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))")
echo "dia a revisar: $DAY"
deadline=$(( $(date +%s) + 40 * 60 ))

open_today() {
  DAY="$DAY" node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
const envPath = "/var/www/autoprestamos/apps/admin/.env.local";
for (const line of readFileSync(envPath, "utf8").split(/\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const day = process.env.DAY || "";
if (!url || !key || !/^\d{4}-\d{2}-\d{2}$/.test(day)) process.exit(2);
const res = await fetch(
  url + "/rest/v1/daily_assignments?dispatch_date=eq." + day + "&day_closed_at=is.null&select=id",
  { method: "HEAD", headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "count=exact" } },
);
if (!res.ok && res.status !== 416) process.exit(3);
const range = res.headers.get("content-range") || "";
const n = Number(range.split("/")[1]);
if (!Number.isFinite(n)) process.exit(4);
process.stdout.write(String(n));
JS
}

# El sellado de las 23:35 va primero. Esta reparacion no lo corta.
sleep 300

while true; do
  n=$(open_today) && code=0 || code=$?
  echo "visitas abiertas de $DAY: ${n:-?} (salida $code)"
  if [ "$code" -eq 0 ] && [ "$n" = "0" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "NO se publica: el dia sigue abierto o no se pudo contar. La app no se reinicia."
    exit 0
  fi
  sleep 30
done

cd /var/www/autoprestamos
if ! git pull -q --ff-only; then
  echo "NO se publica: no se pudo bajar el codigo. La app no se reinicia."
  exit 1
fi
cd apps/admin
if npm run build > /tmp/build-reparacion.log 2>&1; then
  pm2 restart autoprestamos
  echo "VPS: build OK y app reiniciada"
else
  echo "FALLO: build. La app sigue con la version anterior."
  tail -n 30 /tmp/build-reparacion.log
  exit 1
fi

systemctl disable --now autoprestamos-reparacion.timer || true
echo "=== $(date -Is) listo ==="
