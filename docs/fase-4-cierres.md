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

## Después (4.2+)

- Cerrar escritura directa de `cash_float` desde el mirror del aparato
- Corte 23:30 / 6:00 llaman la misma RPC
- Quitar candados `cloud_cie_keeps_cash_float` cuando todos estén en esta versión
