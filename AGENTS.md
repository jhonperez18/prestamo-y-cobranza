# Producción — contrato fijo (también en docs/deployment.md)

## Fuente de verdad

| Pieza | Valor fijo |
| --- | --- |
| Rama | `main` |
| Proyecto Vercel | **solo** `prestamo-y-cobranza` |
| Root Directory | `apps/admin` |
| URL canónica | https://prestamo-y-cobranza.vercel.app |
| Build en login | commit corto (`NEXT_PUBLIC_APP_BUILD` vía `next.config.ts`) |

## Flujo diario (el único)

1. Cambios → commit en `main`
2. `git push origin main`
3. Esperar Ready en Vercel (`prestamo-y-cobranza`)
4. Abrir **solo** https://prestamo-y-cobranza.vercel.app
5. Login: `build` = SHA del commit
6. Opcional: `cd apps/admin && npm run verify:prod`

## Prohibido

- Otro proyecto Vercel para este admin (`admin`, etc.)
- URLs `admin-*.vercel.app` como producción
- Sellos de build manuales / scripts que despliegan a un proyecto y aliasan otro
- Decir “ya está en prod” sin mirar el `build` del login

## Si el usuario ve versión vieja

1. URL = `prestamo-y-cobranza.vercel.app`
2. Login `build` = SHA de `origin/main`
3. Ctrl+F5 o ventana privada
4. Planilla “cerrada” / movimientos 0 antes de 23:30 = estado demo (localStorage), no deploy fallido
5. No crear otro proyecto Vercel
