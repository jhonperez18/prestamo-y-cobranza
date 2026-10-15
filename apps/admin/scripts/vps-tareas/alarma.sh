#!/bin/bash
# Alarma de una tarea del VPS que no terminó bien (systemd: OnFailure=autoprestamos-alarma@%n).
# Pide el correo a la app de este VPS. Registro: /var/log/autoprestamos-alarma.log.
# Prueba: systemctl start autoprestamos-alarma@prueba.service
# Copia en el VPS: /root/tareas/alarma.sh (esta es la versionada).
set -uo pipefail
UNIT="${1:-desconocida}"
ENV=/var/www/autoprestamos/apps/admin/.env.local
LOG=/var/log/autoprestamos-alarma.log
SECRET=$(grep -E '^CRON_SECRET=' "$ENV" | head -n 1 | cut -d= -f2- | tr -d "\"'\r")

case "$UNIT" in
  autoprestamos-respaldo*) SRC=/var/log/autoprestamos-respaldo.log; TASK="Respaldo diario (23:45)" ;;
  autoprestamos-sellado*) SRC=/var/log/autoprestamos-tareas.log; TASK="Sellado de jornadas (23:35)" ;;
  autoprestamos-revision*) SRC=/var/log/autoprestamos-tareas.log; TASK="Revisión de la mañana (6:05)" ;;
  prueba) SRC=/var/log/autoprestamos-tareas.log; TASK="Prueba de la alarma (no hay ninguna falla)" ;;
  *) SRC=/var/log/autoprestamos-tareas.log; TASK="$UNIT" ;;
esac

DETAIL=$(tail -n 15 "$SRC" 2>/dev/null | grep -v 'Node.js 20' | cut -c1-600)
BODY=$(/usr/local/bin/node -e \
  'process.stdout.write(JSON.stringify({task:process.argv[1],unit:process.argv[2],host:process.argv[3],detail:process.argv[4]}))' \
  "$TASK" "$UNIT" "$(hostname)" "$DETAIL")

for URL in http://127.0.0.1:3000/api/ops/alarm https://autoprestamos.org/api/ops/alarm; do
  OUT=$(curl -s -m 60 -X POST -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
    --data "$BODY" -w '\n%{http_code}' "$URL")
  CODE=$(printf '%s' "$OUT" | tail -n 1)
  if [ "$CODE" = "200" ]; then
    echo "$(date -Is) ENVIADA $UNIT por $URL" >> "$LOG"
    exit 0
  fi
  echo "$(date -Is) NO SALIÓ $UNIT por $URL (HTTP $CODE) $(printf '%s' "$OUT" | sed '$d' | head -c 300)" >> "$LOG"
done
exit 1
