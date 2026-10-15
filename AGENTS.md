# Producción — contrato fijo (dueño, 14/10: todo en autoprestamos.org)

## Fuente de verdad

| Pieza | Valor fijo |
| --- | --- |
| Rama | `main` |
| Servidor | VPS propio (PM2 `autoprestamos`, `/var/www/autoprestamos/apps/admin`) |
| URL única | https://autoprestamos.org |
| Datos | Supabase |
| Tareas programadas | systemd del VPS (sellado 23:35, respaldo 23:45, revisión 6:05) |
| Build en login | commit corto (`NEXT_PUBLIC_APP_BUILD` vía `next.config.ts`) |

## Flujo diario (el único)

1. Cambios → commit en `main`
2. `cd apps/admin && npm run release` (push + VPS pull/build/reinicio + revisión)
3. Login de https://autoprestamos.org: `build` = SHA del commit

Dinero operativo (demo): ver `docs/operational-money.md`.  
Personas / Listado (demo): ver `docs/people-catalog.md`.  
**Sistema madre** (ley del producto): ver `docs/sistema-madre.md`.  
**Nube operativa:** Supabase = datos; Git = código; VPS autoprestamos.org = app; este PC = taller (`.cursor/rules/nube-operativa.mdc`).  
Camino a backend: `docs/demo-to-backend.md`.

## Prohibido

- Usar Vercel (desconectado; el dueño no quiere pagar ni depender de él)
- Dominio `cobros.smokecompany.shop` (fuera: sin DNS/API útiles)
- Sellos de build manuales
- Decir “ya está en prod” sin mirar el `build` de autoprestamos.org
- Borrar `localStorage` al limpiar caché

## Si el usuario ve versión vieja

1. URL = `autoprestamos.org`
2. Login `build` = SHA de `origin/main`
3. `npm run verify:prod`; si no coincide, `npm run release`
4. Planilla “cerrada” / movimientos 0 antes de 23:30 = estado del aparato, no deploy fallido
