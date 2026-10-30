# Fase 2 Cobros — dueño en la base

**Estado oficial:** PENDIENTE (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender como cerrada hasta cobro + anulación + gasto como dueño total en prod.

## Ya en prod (parcial)

| Pieza | Qué hace | Qué no |
| --- | --- | --- |
| `register_collection` / `register_combined_collection` | Inserta PG-, tope saldo, `_loan_settle` | Hasta 2.1: no tocaba planilla |
| `void_collection` | Anula PG- + saldo | No reabre visita / Prestar |
| `register_day_expense` | Guarda el GAS- que manda el aparato | No es orden fuerte |
| `create_loan` → `_close_prestar_after_loan` | Cierra Prestar al prestar (Fase 1) | — |

## Corte 2.1 — visita + Prestar al liquidar (este arranque)

**Migración:** `supabase/migrations/20261030223000_fase2_cobro_sella_visita_prestar.sql`

En la misma transacción del cobro:

1. `_seal_visit_after_collection` — visita abierta del P- en el día del PG- → `cobrado` + `payment_ref`
2. Si `balance = 0` y hoja abierta → `_open_prestar_after_paid_off` (una fila Prestar)
3. `client_ref` del PG- se completa desde el préstamo si el aparato lo mandaba vacío
4. Reintento (duplicado) vuelve a sanar sello + Prestar

**Fuera de 2.1:** anulación que reabre planilla, gasto como orden, N/P por orden, cierres (Fase 4), saldos caja (Fase 3).

**Aparato:** sigue pintando en local al confirmar (rápido); la nube es la que deja al supervisor / otros el mismo estado sin esperar el upsert del celular.

## Cómo aplicar la migración

Con contraseña de la DB del proyecto Supabase:

```bash
set SUPABASE_DB_PASSWORD=...
node apps/admin/scripts/apply-fase2-cobros-2_1.mjs
```

O pegar el `.sql` en SQL Editor del dashboard.

## Siguiente (2.2+)

- `void_collection` reabre / quita Prestar según saldo
- Dejar de inventar Prestar solo en el aparato (adoptar respuesta / Realtime)
- Gasto como orden a la base
