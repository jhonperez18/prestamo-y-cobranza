# Fase 3 Saldos — dueño en la base

**Estado oficial:** PENDIENTE (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender cerrada hasta caja M/T, Inicial, A/N y Banco/Nequi lean de la base.

## Corte 3.1 — Inicial M (este arranque)

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

## Después (3.2+)

- Caja viva M / dayFinal leídos de base
- A/N y Banco/Nequi como única fuente de pantalla
- Fase 4: sellar CIE por orden (el aparato deja de subir `cash_float`)
