# Fase 3 Saldos — dueño en la base

**Estado oficial:** lectura **en prod** (3.1–3.3). La escritura del CIE es Fase 4.

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

## Corte 3.3 — A/N y Banco/Nequi (**en prod** · build `c7d378e`)

**Migración:** `supabase/migrations/20261030240000_fase3_route_own_box_pools.sql`

| Qué | Detalle |
| --- | --- |
| RPC | `route_own_box(collector, date, 'A'\|'N')`; wrappers `route_a_box` / `route_n_box` |
| Cifra A/N | Ajuste `AJUSTE@A` / `AJUSTE@N` + efectivo − préstamos − gastos (GAS abierto incluido) |
| RPC pools | `digital_pool_balances` (ya existía; app lo prefiere) |
| App | `/api/ops/route-own-box`, `/api/ops/digital-pool-balances` → caché → `independentRouteDay` / `digitalPoolBalances` |
| Escritura | **Ninguna** — no toca `cash_float` (Fase 4) |

Sin red: sigue el libro local. Días sellados A/N: CIE manda (historia).

## Después

- Fase 4: sellar CIE por orden (el aparato deja de subir `cash_float`)
