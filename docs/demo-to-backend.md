# Camino demo → backend (fase C)

**Estado:** C2 en código (dual-write). Tabla `public.payments` aplicada en el proyecto Supabase.  
**Contrato de dinero vivo:** [`operational-money.md`](operational-money.md)  
**Arquitectura objetivo:** [`architecture.md`](architecture.md)

---

## Por qué esta fase

Hoy celular (Vercel) y PC (localhost) **no comparten** cobros: cada uno tiene su `localStorage`.  
El crecimiento grande exige: **un pago escrito una vez, leído en todos lados**.

---

## Orden profesional (no saltar)

| Paso | Qué | Criterio de listo |
| --- | --- | --- |
| C0 | Contrato PG- estable en demo | Smoke de `operational-money.md` en verde |
| C1 | Migración SQL `payments` (+ RLS) | `supabase/migrations/20260912150000_payments.sql` |
| **C2** | Dual-write al cobrar | Cobro local + fila en `public.payments` |
| C3 | Lectura admin desde Supabase | Truqui PC ve cobro del celular |
| C4 | Apagar localStorage como raíz | Solo Postgres manda |

---

## C2 — checklist operativo

1. **Variables en Vercel** (Production/Preview/Development):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. **Aplicar SQL** una vez en Supabase → SQL Editor → pegar y Run:
   - archivo `supabase/migrations/20260912150000_payments.sql`
3. Redeploy (push o `npm run release:force`) para que Vercel tome el env.
4. Cobrar en app → en Supabase Table Editor debe aparecer el `ref` (`PG-…`).

Código:

- `lib/supabase/payment-mirror.ts`
- `POST /api/payments/mirror`
- Disparo tras cobro calle / caja (`queuePaymentMirror`)

Si Supabase no está o la tabla no existe: el cobro **local sigue**; el espejo es best-effort.

---

## Semántica a preservar

- `ref` tipo `PG-…` (idempotencia / conciliación banco)
- `loan_ref`, `amount`, `paid_date`, `method`, `collector_ref`, `source`
- SQL: `NUMERIC` (nunca float)
- RLS C2: políticas `anon` temporales (quitar en C3 con auth obligatorio)

---

## Siguiente (C3)

Leer `payments` desde Supabase en Truqui (Cobranza / Pagos) y fusionar con demo local hasta cortar el cordón.
