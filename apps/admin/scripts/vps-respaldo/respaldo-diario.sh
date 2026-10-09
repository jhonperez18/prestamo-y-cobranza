#!/bin/bash
# Respaldo diario de Supabase ??? /var/backups/autoprestamos/AAAA-MM-DD.tar.gz (guarda 30 d??as).
set -euo pipefail
DEST=/var/backups/autoprestamos
DAY=$(TZ=America/Bogota date +%F)
WORK="$DEST/$DAY"
ENV=/var/www/autoprestamos/apps/admin/.env.local
mkdir -p "$DEST"
chmod 700 "$DEST"
rm -rf "$WORK"
if node --experimental-websocket --no-warnings --env-file="$ENV" /root/respaldo/respaldo-diario.cjs "$WORK"; then
  tar -czf "$DEST/$DAY.tar.gz.tmp" -C "$DEST" "$DAY"
  mv "$DEST/$DAY.tar.gz.tmp" "$DEST/$DAY.tar.gz"
  chmod 600 "$DEST/$DAY.tar.gz"
  rm -rf "$WORK"
  ls -1t "$DEST"/*.tar.gz | tail -n +31 | xargs -r rm -f
  echo "$(date -Is) OK $DAY $(du -h "$DEST/$DAY.tar.gz" | cut -f1)"
else
  rm -rf "$WORK"
  echo "$(date -Is) FALLA $DAY" >&2
  exit 1
fi
