#!/bin/bash
# Respaldo diario de Supabase → /var/backups/autoprestamos/AAAA-MM-DD.tar.gz (guarda 30 días).
# Segunda copia (solo tablas) → depósito privado `respaldos` de Supabase (7 días).
# Copia en el VPS: /root/respaldo/respaldo-diario.sh (esta es la versionada).
set -euo pipefail
DEST=/var/backups/autoprestamos
DAY=$(TZ=America/Bogota date +%F)
WORK="$DEST/$DAY"
ENV=/var/www/autoprestamos/apps/admin/.env.local
NODE="node --experimental-websocket --no-warnings --env-file=$ENV"
mkdir -p "$DEST"
chmod 700 "$DEST"
rm -rf "$WORK"
if $NODE /root/respaldo/respaldo-diario.cjs "$WORK"; then
  tar -czf "$DEST/$DAY.tar.gz.tmp" -C "$DEST" "$DAY"
  mv "$DEST/$DAY.tar.gz.tmp" "$DEST/$DAY.tar.gz"
  chmod 600 "$DEST/$DAY.tar.gz"
  DATOS="$DEST/datos-$DAY.tar.gz"
  tar -czf "$DATOS" -C "$DEST" --exclude="$DAY/storage" "$DAY"
  rm -rf "$WORK"
  ls -1t "$DEST"/2*.tar.gz | tail -n +31 | xargs -r rm -f
  echo "$(date -Is) OK $DAY $(du -h "$DEST/$DAY.tar.gz" | cut -f1)"
  if $NODE /root/respaldo/subir-copia.cjs "$DATOS"; then
    rm -f "$DATOS"
  else
    rm -f "$DATOS"
    echo "$(date -Is) FALLA copia fuera del VPS $DAY" >&2
    exit 1
  fi
else
  rm -rf "$WORK"
  echo "$(date -Is) FALLA $DAY" >&2
  exit 1
fi
