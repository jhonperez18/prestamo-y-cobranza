# Fase 2 Cobros — dueño en la base

**Estado oficial:** PENDIENTE (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender como cerrada hasta cobro + anulación + gasto como dueño total en prod.

## Completo = cobro + anulación + gasto en la base

| Corte | Qué | Estado |
| --- | --- | --- |
| **2.1** Cobro → visita + Prestar | `register_collection` sella y abre Prestar al liquidar | **En prod** |
| **2.2** Anulación → rearma planilla | `void_collection` reabre visita y quita Prestar si vuelve saldo | **En prod** |
| **2.3** Gasto dueño | Total = suma de líneas; con CIE- no se reescribe | **Listo para pegar** |
| Fase 3 Saldos / Fase 4 Cierres | Caja, CIE por orden | **Otras fases** (no son Fase 2) |

## 2.1 — en prod

**Migración:** `20261030223000_fase2_cobro_sella_visita_prestar.sql`

## 2.2 — en prod

**Migración:** `20261030230000_fase2_void_rearma_planilla.sql`

## 2.3 — pegar ahora

**Migración:** `20261030231500_fase2_gasto_dueno_base.sql`

- `expenses_total` lo calcula la base desde las líneas
- Si ya hay `CIE-` de ese cobrador ese día → `dia_sellado` (no pisa historia)

## Cómo aplicar

SQL Editor → pegar el `.sql` del corte → **Run** → Success.
