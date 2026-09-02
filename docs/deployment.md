# Despliegue

No hay producción en esta fase. Esta es la estrategia cuando exista código.

---

## Entornos

| Entorno | Uso |
| --- | --- |
| local | Docker/Supabase local + apps en dev |
| staging | Copia de esquema, datos ficticios, PWA instalable de prueba |
| production | Proyecto Supabase propio, secretos propios |

Staging y production **nunca** comparten base ni service role.

---

## Piezas

- `apps/admin` → hosting web (Vercel o Nginx + contenedor).
- `apps/pwa` → CDN, dominio dedicado, HTTPS, headers PWA.
- `packages/api` → proceso Node en contenedor, escalable horizontalmente.
- Supabase → Postgres, Auth, Storage, PITR.

Migraciones: pipeline CI. Un humano aprueba producción. Nadie altera tablas en el dashboard.

---

## Backups y fallos

- PITR de Supabase activado en production.
- Ensayo de restore documentado al menos una vez antes de go-live.
- Runbook: API caída, Storage caído, Auth caído (la PWA no inventa cobros).

---

## Secretos

- `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor de API.
- El admin y la PWA reciben únicamente la anon key + URL, y aun así la autorización real está en la API propia para dinero.

---

## Go-live mínimo

Checklist posterior (fases 20–23): HTTPS, backups, rate limit, RLS, pruebas de idempotencia, usuarios reales, un cobrador piloto, no el padrón completo el primer día.
