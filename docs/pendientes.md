# Pendientes — lista viva (dueño 30/10/2026)

Fuente única para no olvidar. Al cerrar un ítem: marcar **HECHO** aquí y en el doc de fase.
**Prohibido** empezar un ítem “por impulso” si dice “solo a pedido”.

| # | Tema | Estado | Cuándo / condición | Dónde |
| --- | --- | --- | --- | --- |
| 1 | **Limpieza candados float (Fase 4)** — asserts / `keepSealedCashFloat` / `cloud_cie_*` | **PENDIENTE** · dejado así | Solo a pedido. Todos los aparatos vivos ≥ build `07b24f3` (ideal `4c5db46`); ~1 semana estable; noche; commit aparte | `docs/fase-4-cierres.md`, `docs/inventario-candados.md`, `fases-dueno-dato.mdc` |
| 2 | **Supervisor Carlos** en build viejo (`4c71d21` = solo 4.1) | **PENDIENTE** operativo | Recargar PWA / abrir autoprestamos.org hasta login `build = 4c5db46` (o más nuevo) | Configuración → Aparatos |
| 3 | **Fase 2 · Realtime** — adoptar planilla solo desde Realtime (remate) | **PENDIENTE** | Revisar / cerrar cuando el dueño pida rematar Fase 2; no vender “2 cerrada al 100 %” antes | `docs/fase-2-cobros.md`, `fases-dueno-dato.mdc` |
| 4 | **Libro de caja (`route-cash-book`)** sin bajar toda la base | **PENDIENTE** | Calcular el libro sin `loadOperationalStateFromCloud()` completo al abrir | `supabase-salida.mdc`, `server-route-cash-book.ts` |
| 5 | **Medir salida (egress) Supabase** | **PENDIENTE** | 1–2 meses bajo ~3–4 GB → decidir plan gratis; **no** declarar “bajo 5 GB” sin cifra del panel | Panel Supabase · `supabase-salida.mdc` |
| 6 | **Limpieza candados Fase 2 / 3** (assert) | **PENDIENTE** | Cuando esa fase esté CERRADA en prod + pedido; lotes 2a–2b assert ya hechos; queda runtime / expects que aún dependen del aparato | `docs/inventario-candados.md` |
| 7 | **Expect renglón GAS-** (Fase 1 leftover) | **PENDIENTE** | Hasta que la caja / renglón no dependa del aparato (escritura saldos); no borrar antes | `inventario-candados.md` §1b |
| 8 | **Declarar Fase 4 “cerrada al 100 %”** | **PENDIENTE** | Después de #1 (candados float) y aparatos vivos en 4.x | `fases-dueno-dato.mdc` |

## Ya no es pendiente (no reabrir)

| Tema | Estado |
| --- | --- |
| Fase 1 Préstamos | **CERRADA** |
| Fase 2 cortes 2.1–2.3 (cobro / void / gasto) | **En prod** |
| Fase 3 lectura 3.1–3.3 | **CERRADA** (lectura) |
| Fase 4 cortes 4.1–4.4 (sellar / mirror / ajuste / reabrir) | **En prod** |
| Limpieza assert Fase 1 (1a–1c) y assert Fase 2 (2a–2b) | **CERRADA** 19/10 |

## Cómo usar

1. Antes de proponer trabajo nuevo → mirar esta tabla.
2. Si el dueño dice “siga” sin tema → el siguiente **no bloqueado** y con sentido de negocio (hoy: no #1).
3. Al terminar un ítem → **HECHO** + fecha + build; no dejar el renglón en el aire.
