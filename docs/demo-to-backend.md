# Camino demo → backend (fase C)

**Estado:** C4 en código — Postgres es la **raíz de pagos** (`PG-`); localStorage es caché + cola offline.  
**Contrato de dinero vivo:** [`operational-money.md`](operational-money.md)  
**Arquitectura objetivo:** [`architecture.md`](architecture.md)

---

## Por qué esta fase

Celular y PC no comparten `localStorage`. Los cobros viven en Supabase (`public.payments`) y cada dispositivo proyecta Cobranza / Banco / CIE desde esos `PG-…`.

---

## Orden profesional

| Paso | Qué | Criterio de listo |
| --- | --- | --- |
| C0 | Contrato PG- estable en demo | Smoke de `operational-money.md` |
| C1 | Migración SQL `payments` | Tabla + RLS |
| C2 | Dual-write al cobrar | Fila en `public.payments` |
| C3 | Lectura + merge | PC ve cobro del celular |
| **C4** | Postgres raíz de pagos | Remoto manda; local = caché / offline |
| C5 | Préstamos / clientes compartidos | Alta en un lado se ve en el otro |
| C6 | Auth + RLS por rol | Quitar `anon` temporal |

---

## C4 — reglas

1. **Cobro:** se guarda local (UX calle) y se sube a Supabase; si falla → cola `nexo-demo-payment-mirror-queue`.
2. **Al abrir / volver a la pestaña:** flush de cola → pull remoto → merge.
3. **Merge:** remoto gana en campos de dinero; se conservan cobros solo-locales (offline) y extras UI (evidencia, gps).
4. **Proyecciones** (planilla, CIE, banco) siguen saliendo de `synchronizeOperationalState` sobre el array fusionado.

Código:

- `lib/supabase/payment-mirror.ts` — persist, flush, pull, merge C4
- `GET /api/payments` · `POST /api/payments/mirror`
- `useOperationalDemoSync` — flush + pull + hidratar

---

## Semántica a preservar

- `ref` tipo `PG-…`
- `loan_ref`, `amount`, `paid_date`, `method`, `collector_ref`, `source`
- SQL `NUMERIC`
- RLS `anon` temporal hasta C6

---

## Siguiente (C5)

Compartir préstamos y clientes (mismo patrón: tabla + dual-write + pull).
