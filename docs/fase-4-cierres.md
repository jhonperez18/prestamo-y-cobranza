# Fase 4 Cierres — dueño en la base

**Estado oficial:** PENDIENTE (`.cursor/rules/fases-dueno-dato.mdc`).  
No vender cerrada hasta que el aparato **deje de subir** `cash_float`.

## Corte 4.1 — orden `close-sheet` + `seal_day_close` (**en prod** · build `4c71d21`)

**Migración:** `supabase/migrations/20261030250000_fase4_seal_day_close.sql`

| Qué | Detalle |
| --- | --- |
| RPC | `seal_day_close(collector, date, route, key, by, write_cie, …)` |
| `cash_float` | Solo `day_cash_figure` (cadena) o `route_own_box` (A/N). **Nunca** el del celular |
| Visitas | Marca `day_closed_at` de la hoja |
| Idempotencia | `SEAL_KEY:…` en `movement_refs` |
| Hoy con CIE del aparato | Adopta y alinea el float a la base |

App: `POST /api/ops/close-sheet` → tras flush de cola. Sin red: sigue el CIE local + cola (compat).

## Corte 4.2 — mirror no escribe float; rollover usa `seal_day_close` (**en prod** · build `07b24f3`)

| Qué | Detalle |
| --- | --- |
| Mirror CIE | Sin CIE en nube → `cie_use_close_sheet` → orden `executeCloseSheet` / `seal_day_close` |
| CIE ya en nube | El aparato **no** cambia `cash_float`; solo une ajustes en `movement_refs` |
| 23:30 | `runServerDayRollover` sella CIE con `callSealDayClose` (mismo dueño) |
| PCE | Siguen por upsert con `force` del servidor |

## Después (4.3+)

- Quitar candados viejos de float cuando todos los aparatos estén en esta versión
- Reabrir / ajuste de saldo como órdenes atómicas en la base
