# Fase 2 Cobros — dueño en la base

**Estado oficial:** cortes 2.1–2.4 en prod (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender limpieza de candados assert (#6) como si fuera este remate.

## Completo = cobro + anulación + gasto en la base + planilla por Realtime

| Corte | Qué | Estado |
| --- | --- | --- |
| **2.1** Cobro → visita + Prestar | `register_collection` sella y abre Prestar al liquidar | **En prod** |
| **2.2** Anulación → rearma planilla | `void_collection` reabre visita y quita Prestar si vuelve saldo | **En prod** |
| **2.3** Gasto dueño | Total = suma de líneas; con CIE- no se reescribe | **En prod** |
| **2.4** Planilla por Realtime | Tras cobro/anulación el aparato **no** encola `daily_assignments`; otros adoptan por Realtime ops | **En prod** (remate) |
| Fase 3 Saldos / Fase 4 Cierres | Caja, CIE por orden | **Otras fases** (no son Fase 2) |

## 2.1 — en prod

**Migración:** `20261030223000_fase2_cobro_sella_visita_prestar.sql`

## 2.2 — en prod

**Migración:** `20261030230000_fase2_void_rearma_planilla.sql`

## 2.3 — en prod

**Migración:** `20261030231500_fase2_gasto_dueno_base.sql`

- `expenses_total` lo calcula la base desde las líneas
- Si ya hay `CIE-` de ese cobrador ese día → `dia_sellado` (no pisa historia)

**Aparato:** si la base responde `dia_sellado`, la cola no reintenta eterno (`ops-mirror`).

## 2.4 — remate Realtime (en prod)

Tras `register_collection` / `void_collection` la base ya escribió la planilla.

| Pieza | Regla |
| --- | --- |
| Aparato que cobró / anuló | Pinta local al instante; **no** `queueAssignmentsMirror` de esa visita |
| Rename PG- local | Solo local; **no** re-espeja planilla (`adoptCloudPaymentRefs`) |
| Otros aparatos | Adoptan `daily_assignments` por Realtime (`ops`) + poll de respaldo |
| Sigue encolando planilla | N/P, Prestar (sí/no), cierre de hoja, préstamo nuevo, renovar, alta cliente; rechazo de cobro sí rearma visita |

**Candado:** `assert-cash-chain.mjs` («Fase 2 remate: cobro…», «anulación…»).
