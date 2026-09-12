# Camino demo → backend (fase C)

**Estado:** cimiento. No apaga localStorage todavía.  
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
| C1 | Migración SQL `payments` (+ RLS borrador) | Archivo en `supabase/migrations/` |
| C2 | Escritura opcional Supabase al cobrar (dual-write) | Cobro en Vercel aparece en tabla |
| C3 | Lectura admin desde Supabase (con fallback demo) | Truqui PC ve cobro del celular |
| C4 | Apagar localStorage como raíz de pagos | Solo Postgres manda |

**Ahora implementamos C1** (cimiento). C2–C4 requieren sesión y variables de entorno listas.

---

## Semántica a preservar

- `ref` tipo `PG-…` (idempotencia / conciliación banco)
- `loan_ref`, `amount`, `paid_date`, `method`, `collector_ref`, `source` (`ruta` \| `caja` \| …)
- Nunca float: en SQL usar `NUMERIC`
- RLS: cobrador solo escribe/lee lo suyo; admin lee todo

Hasta C3, el demo sigue siendo la UX principal.
