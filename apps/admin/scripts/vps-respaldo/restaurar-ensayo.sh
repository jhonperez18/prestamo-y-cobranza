#!/bin/bash
# Copia de ensayo: restaura un respaldo en la base local `ensayo` del VPS (127.0.0.1, nunca expuesta)
# y compara filas tabla por tabla contra producción. No escribe en Supabase.
# Uso: restaurar-ensayo.sh [AAAA-MM-DD]   (sin fecha = respaldo más reciente)
# Copia en el VPS: /root/respaldo/restaurar-ensayo.sh (esta es la versionada).
set -euo pipefail
DEST=/var/backups/autoprestamos
DAY="${1:-$(ls -1 "$DEST"/2*.tar.gz | sort | tail -n 1 | xargs -n1 basename | cut -d. -f1)}"
TAR="$DEST/$DAY.tar.gz"
PROD="host=db.connkdwezlwqlwgjerav.supabase.co port=5432 dbname=postgres user=postgres sslmode=require connect_timeout=20"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

[ -f "$TAR" ] || { echo "no existe $TAR"; exit 1; }
tar -xzf "$TAR" -C "$WORK" "$DAY/base-public.dump"
DUMP="$WORK/$DAY/base-public.dump"
chmod -R a+rX "$WORK"

local_psql() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q "$@"; }

local_psql -c "DROP DATABASE IF EXISTS ensayo WITH (FORCE)" -c "CREATE DATABASE ensayo"
local_psql -d ensayo <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
END $$;
-- El respaldo trae su propio esquema public (con sus permisos).
DROP SCHEMA public CASCADE;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE SCHEMA realtime;
-- En ensayo no se avisa a ningún aparato.
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
  RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
GRANT USAGE ON SCHEMA auth, realtime TO anon, authenticated, service_role;
SQL

ERRORS="$WORK/restore.err"
if ! sudo -u postgres pg_restore --no-owner -d ensayo "$DUMP" 2> "$ERRORS"; then
  echo "pg_restore con errores:"; cat "$ERRORS"; exit 1
fi

TABLES=$(local_psql -d ensayo -Atc "select tablename from pg_tables where schemaname='public' order by 1")
FAIL=0
printf '%-28s %10s %10s\n' tabla ensayo produccion
for t in $TABLES; do
  a=$(local_psql -d ensayo -Atc "select count(*) from public.\"$t\"")
  b=$(psql "$PROD" -Atc "select count(*) from public.\"$t\"")
  mark=""
  if [ "$a" -gt "$b" ]; then mark="  <- ensayo tiene más"; FAIL=1; fi
  if [ "$a" -lt "$b" ]; then mark="  (producción siguió sumando desde el respaldo)"; fi
  printf '%-28s %10s %10s%s\n' "$t" "$a" "$b" "$mark"
done
fn=$(local_psql -d ensayo -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
pol=$(local_psql -d ensayo -Atc "select count(*) from pg_policies where schemaname='public'")
echo "funciones: $fn · reglas de permisos: $pol · respaldo: $DAY"
exit $FAIL
