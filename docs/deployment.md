# Despliegue — contrato fijo

Este documento **define** producción. No es una guía de parches.

## Una sola producción

| Pieza | Valor |
| --- | --- |
| Repo | `jhonperez18/prestamo-y-cobranza` |
| Rama | `main` |
| Proyecto Vercel | `prestamo-y-cobranza` (**único** conectado a GitHub) |
| Root Directory | `apps/admin` |
| URL | https://prestamo-y-cobranza.vercel.app |
| Id de versión | commit corto en el login (`build xxxxxxx`) |

El proyecto Vercel llamado `admin` quedó **desconectado de GitHub**. No usarlo. No volver a conectarlo.

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

1. **Un solo proyecto Git → Vercel** (sin duplicados).
2. **El sello `build` sale del commit en cada build** (`next.config.ts` → `NEXT_PUBLIC_APP_BUILD`). No hay archivo de sello manual.
3. **HTML raíz sin caché agresiva** (headers en `next.config.ts`).
4. **Regla Cursor** `.cursor/rules/production-deploy.mdc` para que agentes no improvisen otro deploy.

## Qué NO es “código viejo”

- Datos demo en `localStorage` del navegador (siguen ahí aunque el JS sea nuevo).
- Abrir una URL `admin-*.vercel.app` de un deploy antiguo.
- Comparar localhost con producción sin mirar el `build` del login.

## Entornos futuros (API / Supabase)

| Entorno | Uso |
| --- | --- |
| local | Dev |
| staging | Datos ficticios |
| production | Secretos propios |

Staging y production no comparten base ni service role.
