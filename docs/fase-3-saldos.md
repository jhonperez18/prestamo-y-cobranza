# Fase 3 Saldos — dueño en la base

**Estado oficial:** PENDIENTE (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender cerrada hasta caja M/T, Inicial, A/N y Banco/Nequi lean de la base.

## Corte 3.1 — Inicial M (**en prod** · build `efd99c0`)

**Migración:** `supabase/migrations/20261030233000_fase3_chain_m_opening.sql`

| Qué | Detalle |
| --- | --- |
| RPC | `chain_m_opening(collector, date)` |
| Cifra | Inicial M = `cash_float` del último `CIE-` anterior al día |
| `ready: false` | Sin CIE previo, o hay día cerrado después sin su CIE (`cie_faltante`) |
| Escritura | **Ninguna** — no toca `cash_float` (eso es Fase 4) |

App: `/api/ops/chain-m-opening` → caché `cloud-chain-m-opening` → `openingCashForChainedPlanilla` prefiere la base. Sin red: CIE local.

## Cómo aplicar

SQL Editor → pegar el `.sql` → **Run** → Success → publicar app.

## Corte 3.2 — caja viva M / dayFinal (**en prod** · build `06cc209`)

**Migración:** `supabase/migrations/20261030234500_fase3_day_cash_figure_ready.sql`

| Qué | Detalle |
| --- | --- |
| RPC | `day_cash_figure` endurecido: Inicial = `chain_m_opening`; `ready` |
| Cifras | `m_closing`, `day_final`; si hay CIE del día → `saldo` = CIE |
| App | `/api/ops/day-cash-figure` → caché → `buildDayCashLedger` prefiere la base |

## Después (3.3+)

- A/N y Banco/Nequi como única fuente de pantalla
- Fase 4: sellar CIE por orden (el aparato deja de subir `cash_float`)
