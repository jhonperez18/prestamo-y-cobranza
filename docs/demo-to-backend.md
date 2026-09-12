# Camino demo → backend (fase C)

**Estado:** C3 en código (lectura + merge por `ref`). Dual-write C2 sigue activo.  
**Contrato de dinero vivo:** [`operational-money.md`](operational-money.md)  
**Arquitectura objetivo:** [`architecture.md`](architecture.md)

---

## Por qué esta fase

Celular (Vercel) y PC (localhost u otro navegador) tienen `localStorage` distinto.  
C2 escribe cobros en Supabase; **C3 los vuelve a leer** para que ambos vean los mismos `PG-…`.

---

## Orden profesional (no saltar)

| Paso | Qué | Criterio de listo |
| --- | --- | --- |
| C0 | Contrato PG- estable en demo | Smoke de `operational-money.md` en verde |
| C1 | Migración SQL `payments` (+ RLS) | `supabase/migrations/20260912150000_payments.sql` |
| C2 | Dual-write al cobrar | Cobro local + fila en `public.payments` |
| **C3** | Lectura + merge en demo | Truqui PC ve cobro del celular (y viceversa) |
| C4 | Apagar localStorage como raíz | Solo Postgres manda |

---

## C3 — checklist operativo

1. Env + tabla `payments` (ya en C2).
2. Abrir / volver a la pestaña → `GET /api/payments` → merge por `ref` en `nexo-demo-payments`.
3. Si entraron refs nuevos → re-hidratar (`hydrateOperationalDemo` / proyecciones).
4. Local gana si el `ref` ya existe (no pisa cobros locales).

Código:

- `lib/supabase/payment-mirror.ts` (`pullRemotePaymentsIntoDemo`, `mergePaymentsByRef`)
- `GET /api/payments`
- `useOperationalDemoSync` (pull al montar y al `visibilitychange`)

**Límite C3:** préstamos / clientes nuevos solo en un dispositivo aún no se sincronizan; solo **pagos**.

---

## C2 — dual-write (sigue)

- `POST /api/payments/mirror` tras cobro calle / caja
- Si el espejo falla: el cobro local no se tumba

---

## Semántica a preservar

- `ref` tipo `PG-…` (idempotencia / conciliación banco)
- `loan_ref`, `amount`, `paid_date`, `method`, `collector_ref`, `source`
- SQL: `NUMERIC` (nunca float)
- RLS: políticas `anon` temporales hasta auth obligatorio (C4)

---

## Siguiente (C4)

Hacer de Postgres la raíz de pagos y dejar localStorage como caché / offline.
