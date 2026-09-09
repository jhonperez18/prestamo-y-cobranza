# Despliegue

## Producción actual (admin Next.js)

| Pieza | Valor |
| --- | --- |
| Repo / rama | `jhonperez18/prestamo-y-cobranza` → `main` |
| Proyecto Vercel **único** | `prestamo-y-cobranza` |
| Root Directory | `apps/admin` |
| URL canónica | https://prestamo-y-cobranza.vercel.app |
| Build id en login | commit corto (`VERCEL_GIT_COMMIT_SHA` vía `scripts/stamp-build.mjs`) |

### Por qué a veces “se ve viejo”

1. **Dos proyectos Vercel** (`prestamo-y-cobranza` y `admin`) apuntaban al mismo repo. Un URL se actualizaba y el otro no, o el sello `build` del login quedaba congelado.
2. El sello `APP_BUILD` solo se regeneraba con `deploy:prod` manual; los deploys por GitHub seguían mostrando un commit antiguo aunque el código sí fuera nuevo.
3. Datos demo en `localStorage` del navegador no son el código: parecen “versión vieja” si no se limpian.

### Regla operativa (no romper diario)

- **Solo** usar https://prestamo-y-cobranza.vercel.app
- Tras cada push a `main`, verificar en login: `build` = SHA de GitHub
- Hard refresh si hace falta (Ctrl+F5) o ventana privada
- No publicar con el proyecto Vercel `admin` (dejarlo desconectado del Git o borrarlo cuando se pueda)
- Emergencia: `cd apps/admin && npm run deploy:prod`

### Flujo normal

```bash
git push origin main
# Esperar Ready en Vercel → abrir prestamo-y-cobranza.vercel.app
```

---

## Entornos futuros (API / Supabase)

| Entorno | Uso |
| --- | --- |
| local | Docker/Supabase local + apps en dev |
| staging | Copia de esquema, datos ficticios |
| production | Proyecto Supabase propio, secretos propios |

Staging y production **nunca** comparten base ni service role.

### Piezas previstas

- `apps/admin` → Vercel (ya)
- `apps/pwa` → CDN / dominio dedicado
- `packages/api` → proceso Node
- Supabase → Postgres, Auth, Storage, PITR

### Secretos

- `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor de API.
- El admin recibe únicamente anon key + URL cuando exista backend real.
