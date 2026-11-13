# Pendientes — lista viva (dueño 30/10/2026)

Fuente única para no olvidar. Al cerrar un ítem: marcar **HECHO** aquí y en el doc de fase.
**Prohibido** empezar un ítem “por impulso” si dice “solo a pedido”.

| # | Tema | Estado | Cuándo / condición | Dónde |
| --- | --- | --- | --- | --- |
| 17 | **Puerta ruta+día** (apps cobrador/supervisor) | **HECHO 10/11** · raíz | Gastos·préstamos·efectivo·banco/nequi·N/P vía `/api/ops/route-day-detail`. Inicial/CIE intactos. Historial caja · Cobros = solo efectivo (Banco fuera). Pendiente menor: gastos Banco informe | `route-day-detail.mdc`, `day-cash-ledger.ts` |
| 1 | **Limpieza candados float (Fase 4)** — `keepSealedCashFloat` / asserts §2 | **PARCIAL 12/11** · runtime muerto quitado | HECHO: `keepSealedCashFloat` + expect «Candado revierte…». **Queda:** `cloud_cie_*` (defensa servidor 4.2, no borrar) y asserts §4b/7/15/23/29 solo a pedido | `docs/fase-4-cierres.md`, `docs/inventario-candados.md` |
| 2 | **Aparatos en build atrasado** | **OK 12/11** · prod `3b5c2a1` | Tu celular + admin en `3b5c2a1`. Alarmas viejas = otros `deviceId` (mismo teléfono, 3 logins). No bloquea | Configuración → Aparatos |
| 3 | **Fase 2 · Realtime** — adoptar planilla solo desde Realtime (remate) | **HECHO 02/11** · `2fbb41a` · corte 2.4 | Cobro/anulación/panel/tardío ya no encolan planilla; otros por Realtime ops. N/P·Prestar·cierre siguen encolando | `docs/fase-2-cobros.md` |
| 16 | **Cobrador 1 ruta (Yesid)** — Efectivo/Banco del cierre vacíos | **HECHO 02/11** · `2f55c45` **raíz** | Pin único = `activePlanillaRoute`. Lista = `routeCash/DigitalPayments`. Sin fallback paralelo | `CollectorMobileApp.tsx`, assert-cash-chain |
| 4 | **Libro de caja (`route-cash-book`)** sin bajar toda la base | **HECHO 01/11** | RPC `day_cash_figure` (M) / `route_own_box` (A/N); sin `loadOperationalStateFromCloud()` | `supabase-salida.mdc`, `server-route-cash-book.ts` |
| 5 | **Salida (egress) Supabase** | **MEDIDO 12/11** · ciclo 10 nov–10 dic · **Free** · Salida **1,694 / 5 GB (34 %)** · sin excedente aún | Muy temprano (~2 d). Volver a mirar ~25/11 y al cierre 10/12. No declarar “bajo 5 GB del mes” todavía | Panel Usage · `supabase-salida.mdc` |
| 15 | **chain-audit verde vacío** (domingo sin CIE calendario) | **HECHO 02/11** · `cf0c975` | Ancla al último CIE real; verify falla si no hay filas. Edgar 82k · Yesid 1.311.500 | `server-chain-audit.ts` |
| 6 | **Limpieza candados Fase 2 / 3** (assert) | **NO ES BORRAR YA** | Assert 2a–2b ya limpio. Lo que queda = **dueño en la base** (gasto/cola), no quitar expects a ciegas. Apartar hasta esa etapa | `docs/inventario-candados.md` |
| 7 | **Expect renglón GAS-** (Fase 1 leftover) | **NO ES BORRAR YA** | Renglón sigue en el aparato. Borrar expect = daño. Apartar hasta escritura de saldos/renglón en la base | `inventario-candados.md` §1b |
| 8 | **Declarar Fase 4 “cerrada al 100 %”** | **PENDIENTE** | Solo después de ejecutar #1 y aparatos al día | `fases-dueno-dato.mdc` |
| 9 | **CIE huérfano / Inicial en 0 al amanecer** (31/10: Edgar M/T = 0) | **HECHO 31/10** | SQL `day_closed_at` text + CIE 30/10 sellados (Edgar 4.238.000 · Yesid 3.279.500) + morning-check sella huérfanos | `20261031120000_…`, `server-seal-orphan-cie.ts` |
| 10 | **N Inicial ≠ saldo** (AJUSTE@ viejo > CIE) | **HECHO 31/10** | `route_own_box` ancla al más reciente AJUSTE@ / CIE; N hoy = 3.279.500 | `20261031123000_…` |
| 11 | **A dañada por ancla CIE de cadena** (Edgar CIE 4.238.000 ≠ caja A) | **HECHO 31/10** | CIE ancla solo si el día **no** es M/T; A → AJUSTE@A + movimiento (hoy 747.000). Contrato: solo M↔T mezclan; A y N independientes | `20261031124500_…`, `docs/fase-3-saldos.md` |
| 12 | **Supervisor: hoja Ruta = espejo cobrador** (V, Prestar, vivo); sin botón Planilla | **HECHO 31/10** · build `f184527` | Solo vista. Un RUTA (menú). Ficha INICIO sin botón doble | `docs/supervisor-ruta-vs-planilla.md` |
| 13 | **CIE Edgar 31/10 = caja A** (cierre A pisó cadena) | **HECHO 01/11** · dato; **SQL pegado 02/11** | CIE cadena = 82.000; A = 827.000. `seal_day_close` en base: A/N en día M/T no pisan `cash_float` | `20261101120000_seal_day_close_a_no_pisa_cie.sql` |
| 14 | **MES- octubre 2026** faltaba al cruzar mes | **HECHO 01/11** | `MES-COB-0-2026-10` = 82.000 · `MES-COB-1-2026-10` = 1.311.500 | `month-closes/` |

## Ya no es pendiente (no reabrir)

| Tema | Estado |
| --- | --- |
| Fase 1 Préstamos | **CERRADA** |
| Fase 2 cortes 2.1–2.4 (cobro / void / gasto / Realtime planilla) | **En prod** |
| Fase 3 lectura 3.1–3.3 | **CERRADA** (lectura) |
| Fase 4 cortes 4.1–4.4 (sellar / mirror / ajuste / reabrir) | **En prod** |
| Limpieza assert Fase 1 (1a–1c) y assert Fase 2 (2a–2b) | **CERRADA** 19/10 |

## Mapa #1 — limpieza float (12/11)

| Pieza | Estado |
| --- | --- |
| Runtime `keepSealedCashFloat` | **HECHO 12/11** — borrado; `align` solo toca `collected` / `expensesTotal` |
| Assert §2 expect «Candado revierte saldo pisado» | **HECHO 12/11** — quitado; queda «Alinear pagos conserva CIE-25» (regla) |
| Mirror `cloud_cie_*` | **SE QUEDA** — defensa servidor 4.2 (no es candado muerto del aparato) |
| Assert §4b / §7 nube / §15 / §23 / §29 | **Pendiente** — solo a pedido, commit aparte |

**Fuera de este commit:** #6, #7, cobros, planilla, UI, egress.

## Cómo usar

1. Antes de proponer trabajo nuevo → mirar esta tabla.
2. Si el dueño dice “siga” sin tema → el siguiente **no bloqueado** y con sentido de negocio.
3. Al terminar un ítem → **HECHO** + fecha + build; no dejar el renglón en el aire.
4. **Cero parches (02/11):** si no es raíz → parar. No “mientras tanto”, no “para este celular”.
5. **#1:** primer corte HECHO 12/11 (`keepSealedCashFloat`). `cloud_cie_*` y asserts §4b+ no se tocan sin pedido.
