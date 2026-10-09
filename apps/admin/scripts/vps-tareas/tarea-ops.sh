#!/bin/bash
# Tareas del negocio en el VPS (sellado 23:35 / 00:10 y revisión 6:05, hora Bogotá).
# Vercel Cron corre las mismas 5 min antes; son idempotentes (un corte = un sellado, un correo).
# Uso: tarea-ops.sh day-rollover | morning-check
# Copia en el VPS: /root/tareas/tarea-ops.sh (esta es la versionada).
set -uo pipefail
TASK="${1:?falta la tarea}"
ENV=/var/www/autoprestamos/apps/admin/.env.local
LOG=/var/log/autoprestamos-tareas.log
SECRET=$(grep -E '^CRON_SECRET=' "$ENV" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$SECRET" ] || { echo "$(date -Is) FALLA $TASK: sin CRON_SECRET" >> "$LOG"; exit 1; }

for attempt in 1 2 3; do
  BODY=$(curl -s -m 120 -X POST -H "Authorization: Bearer $SECRET" -w '\n%{http_code}' \
    "http://127.0.0.1:3000/api/ops/$TASK")
  CODE=$(printf '%s' "$BODY" | tail -n 1)
  JSON=$(printf '%s' "$BODY" | sed '$d')
  if [ "$CODE" = "200" ] && printf '%s' "$JSON" | grep -q '"ok":true'; then
    echo "$(date -Is) OK $TASK (intento $attempt) $(printf '%s' "$JSON" | head -c 400)" >> "$LOG"
    exit 0
  fi
  echo "$(date -Is) REINTENTO $TASK (intento $attempt, HTTP $CODE) $(printf '%s' "$JSON" | head -c 300)" >> "$LOG"
  sleep 60
done
echo "$(date -Is) FALLA $TASK tras 3 intentos" >> "$LOG"
exit 1
