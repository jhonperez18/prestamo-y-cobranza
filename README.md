# Sistema profesional de préstamos y cobranza

Producto comercial para administrar clientes, préstamos, cuotas, pagos, abonos, rutas y cobradores, con un sistema administrativo de escritorio y una PWA para campo.

**Estado actual:** se está construyendo el admin (`apps/admin`). El sidebar de variantes va a la **izquierda**. Las reglas financieras y las tablas reales se cierran mientras avanzamos.

## Cómo correrlo

```bash
cd apps/admin
npm run dev
```

Abre http://localhost:3000 — módulos arriba, variantes a la izquierda, trabajo al centro.

## Producción (una sola URL)

**URL canónica:** https://prestamo-y-cobranza.vercel.app

Cada `git push` a `main` despliega ese dominio (proyecto Vercel `prestamo-y-cobranza`, Root Directory `apps/admin`).

En el login debe verse `build` = commit corto de GitHub (ej. `cdfcd9c`). Si el build no cambia, estás en una URL vieja o con caché del navegador.

| Usar | No usar (proyecto duplicado) |
| --- | --- |
| https://prestamo-y-cobranza.vercel.app | https://admin-*.vercel.app / proyecto Vercel `admin` |

Emergencia (forzar deploy + limpiar CDN): `cd apps/admin && npm run deploy:prod`
## Documentación

| Documento | Contenido |
| --- | --- |
| [architecture.md](docs/architecture.md) | Arquitectura, tecnologías, módulos, ER, seguridad, plan de fases |
| [ui-navigation.md](docs/ui-navigation.md) | Enfoque visual: top bar + variantes a la izquierda |
| [database.md](docs/database.md) | Modelo de datos, tablas, relaciones, índices |
| [api.md](docs/api.md) | Contratos de API por módulo |
| [security.md](docs/security.md) | Autenticación, autorización, amenazas |
| [financial-rules.md](docs/financial-rules.md) | Motor financiero — **fórmulas pendientes de aprobación** |
| [pwa.md](docs/pwa.md) | PWA de cobradores |
| [storage.md](docs/storage.md) | Archivos, firmas, evidencias |
| [audit.md](docs/audit.md) | Auditoría y trazabilidad |
| [testing.md](docs/testing.md) | Estrategia de pruebas |
| [deployment.md](docs/deployment.md) | Despliegue y entornos |

La arquitectura y las decisiones de dinero siguen en `/docs`. El admin se organiza módulo a módulo mientras se ejecuta.
