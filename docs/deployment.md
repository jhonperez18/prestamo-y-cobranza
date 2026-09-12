# Despliegue — contrato fijo

Este documento **define** producción. No es una guía de parches.

## Una sola producción

| Pieza | Valor |
| --- | --- |
| Repo | `jhonperez18/prestamo-y-cobranza` |
| Rama | `main` |
| Proyecto Vercel | `prestamo-y-cobranza` (**único** conectado a GitHub) |
| Root Directory | `apps/admin` |
| URL principal | https://prestamo-y-cobranza.vercel.app |
| Alias (misma app) | https://admin-jhon-fredy-perezs-projects.vercel.app |
| Id de versión | commit corto en Resumen / login (`Código en este sitio`) |

El proyecto Vercel llamado `admin` se eliminó; su URL quedó como **alias** del proyecto bueno para que no dé 404.

## Flujo diario

```bash
git push origin main
# Vercel construye solo prestamo-y-cobranza
# Abrir https://prestamo-y-cobranza.vercel.app
# Login → build = SHA del commit
```

Verificación rápida:

```bash
cd apps/admin
npm run verify:prod
```

Emergencia (rebuild forzado al mismo dominio):

```bash
cd apps/admin
npm run release:force
```

## Cómo se garantiza que no “quede viejo”

1. **Un solo proyecto Git → Vercel** (`prestamo-y-cobranza`). El proyecto `admin` ya no existe; su URL es solo alias.
2. **El sello `build` sale del commit en cada build** (`next.config.ts` → `NEXT_PUBLIC_APP_BUILD`). No hay archivo de sello manual.
3. **HTML raíz sin caché agresiva** (headers en `next.config.ts`).
4. **Aliases alineados**: `npm run verify:prod` apunta `prestamo-y-cobranza.vercel.app` y `admin-jhon-fredy-perezs-projects.vercel.app` al mismo deploy Ready.
5. **Enlace local CLI**: siempre `npx vercel link --yes --project prestamo-y-cobranza` (nunca `admin`).
6. **Regla Cursor** `.cursor/rules/production-deploy.mdc` para que agentes no improvisen otro deploy.

## Qué NO es “código viejo”

- Datos demo en `localStorage` del navegador (siguen ahí aunque el JS sea nuevo).
- Abrir una URL `admin-*.vercel.app` de un deploy antiguo.
- Comparar localhost con producción sin mirar el `build` del login.
- “Cerrar día” que no se queda cerrado: bug corregido — el ciclo operativo ya no reabre jornadas cerradas a mano antes de las 23:30. Si el estado demo está raro: ventana privada o borrar keys `nexo-demo-*` del origen.

## Entornos futuros (API / Supabase)

| Entorno | Uso |
| --- | --- |
| local | Dev |
| staging | Datos ficticios |
| production | Secretos propios |

Staging y production no comparten base ni service role.
