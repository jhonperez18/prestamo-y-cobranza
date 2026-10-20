# Inventario de candados — `apps/admin/scripts/assert-cash-chain.mjs` (09/10/2026)

**Estado firme (19/10):** Fase 1 Préstamos = **CERRADA** en prod. No rehacer.
Pendiente real: limpiar ~50 candados de esa fase (solo si el dueño lo pide) + Fases 2–4.
Regla del agente: `.cursor/rules/fases-dueno-dato.mdc`.

683 `expect` en el código (727 al correr: algunos van en ciclos), 33 bloques.
Cifras por clase: **aproximadas** (las secciones grandes mezclan temas; se contó por título de prueba).

| Clase | Qué es | Destino | ~Pruebas |
| --- | --- | --- | --- |
| **Regla** | Regla del negocio (Inicial M = CIE ayer, A solo Nequi, rutas no se mezclan, renovar sin plata) | Se queda como prueba; al migrar, pasa a prueba de la base | ~370 |
| **Candado** | Existe porque el aparato es dueño del dato (choques, reintentos, pull que rebobina, proyección que pisa) | Se **borra** en la fase que pasa ese dato a la base | ~210 |
| **Caché** | El celular guarda copia para trabajar sin señal (cupo, bajada liviana, celular liviano, auto-revisión) | Se queda, más chica | ~100 |

## Por sección

| § | Líneas | Pruebas | Tema | Clase | Fase que la quita / destino |
| --- | --- | --- | --- | --- | --- |
| 1 | 169-174 | 3 | Inicial M = CIE de ayer | Regla | Prueba de la base (Saldos) |
| 3 | 175-217 | 6 | Inicial T = caja viva de M; Historial | Regla | Prueba de la base (Saldos) |
| 2 | 218-245 | 4 | Proyecciones no tocan el saldo sellado (`keepSealedCashFloat`, provisional) | Candado | 4 Cierres |
| 4a | 246-270 | 6 | Cerrar M y luego T | Regla | Prueba de la base (Cierres) |
| 4b | 271-300 | 3 | Auto-cierre 23:30 del aparato | Candado | 4 Cierres |
| 5 | 301-455 | 46 | Cada planilla con lo suyo (préstamo/gasto de T sale de T) | Regla | Prueba de la base (Saldos) |
| 6 | 456-573 | 18 | Pago tardío | Regla | Prueba de la base (Cobros) |
| 7 | 574-670 | 20 | Ajuste de saldo real en T | Regla (~16) + Candado nube (~4) | 4 Cierres quita la parte nube |
| 8 | 671-729 | 14 | Cartera existente no descuenta caja | Regla | Saldos |
| 9 | 730-774 | 6 | Pagar desde el panel: destino | Regla | Cobros |
| 10 | 775-799 | 6 | Modificar préstamo: renglón GAS- sigue al capital | Candado | 3 Saldos (la caja sale del préstamo, no de un renglón copiado) |
| 11 | 800-1369 | 80 | A y N: caja propia, ajustes; N con PCE-T proyectado; Cobro en T no toca M; Hoy lleno de N; M cerrada abre T | Regla (~45) + Candado (~25) + Pantalla (~10) | Candados: 3 Saldos / 4 Cierres. Pantalla se queda |
| 12 | 1370-2129 | 98 | Banco: cuenta por ruta, oficina, historial Banco, DSB | Regla (~70) + Candado (~25) | 3 Saldos (el banco hoy es proyección del aparato) |
| 13 | 2130-2536 | 65 | Total acumulado BANCO / NEQUI | Regla (~60) + Candado (~5) | 3 Saldos |
| 14 | 2537-3040 | 51 | Prestar atendido (~12, regla) + Albornoz / Haber de Banco duplicado (~39) | Regla + Candado | Albornoz: 1 Préstamos + 3 Saldos |
| 15 | 3041-3062 | 4 | Día 1 del mes no bloquea | Candado | 4 Cierres |
| 16 | 3063-3168 | 21 | Préstamo activo = una regla; un préstamo por cliente | Regla (~15) + Candado (~6) | 1 Préstamos (la base ya lo exige: `create_loan`) |
| 17 | 3169-3232 | 11 | Auto-revisión de la planilla | Caché | Se queda |
| 18 | 3233-3314 | 11 | Gasto del cobrador: cola no pierde | Candado | 2 Cobros (gasto por función de la base) |
| 19 | 3315-3381 | 14 | Préstamo del supervisor a cargo de la ruta | Regla | Saldos |
| 27 | 3382-3448 | 15 | Anexo (sube capital con día cerrado) | Regla (~8) + Candado (~7) | 3 Saldos |
| 20 | 3449-3510 | 10 | Botón Préstamos del cobrador (Efectivo + Banco/Nequi) | Regla (pantalla) | Se queda |
| 21 | 3511-3559 | 9 | Punto de conexión del cobrador | Caché / monitor | Se queda |
| 22 | 3560-3720 | 15 | Aparato sin el CIE de ayer (03/10) | Candado | 3 Saldos (el Inicial lo da la base) |
| 23 | 3721-3787 | 7 | Revisión 6:00 | Monitor (~3) + Candado (~4) | 4 Cierres quita «sella lo pendiente» |
| 24 | 3788-3849 | 13 | Bajada liviana | Caché | Se queda |
| 25 | 3850-3880 | 9 | Informe = libro del día | Regla | Saldos |
| 26 | 3881-4615 | 60 | Cupo / IndexedDB (~25, caché) + Choque P-434, Reintento Celina, préstamo duplicado, fichas (~30) + saldo del cobrador (~5) | Caché + Candado | P-434 / Celina: 1 Préstamos. Saldo: 2 Cobros |
| 29 | 4616-4791 | 12 | Reabrir hoja de hoy | Regla (~6) + Candado marca `REABIERTA` (~6) | 4 Cierres |
| 30 | 4792-4927 | 18 | Renovar: +20 %, sin plata | Regla (~14) + Candado (~4) | 1 Préstamos (`renew_loan` ya en la base) |
| 31 | 4928-5025 | 7 | Saldo por ficha (Jhon Flaca) | Candado | 2 Cobros (la base ya calcula con `_loan_settle`) |
| 32 | 5026-5147 | 20 | Celular liviano | Caché | Se queda |

## Candados por fase (los que se borran)

| Fase | ~Candados | Secciones |
| --- | --- | --- |
| 1 Préstamos | ~50 | 14 (Albornoz), 16, 26 (P-434, Celina, duplicados), 30 |
| 2 Cobros | ~30 | 11 (cobro en T sella), 18, 26 (saldo), 31 |
| 3 Saldos | ~80 | 10, 11 (N / PCE-T), 12 (DSB), 13, 22, 27 |
| 4 Cierres | ~40 | 2, 4b, 7 (nube), 11 (ajustes nube), 15, 23, 29 |

## Reglas de trabajo

1. Una fase borra sus candados **una semana después** de correr estable en producción, en commit aparte (reversible).
2. Las reglas no se borran: pasan a prueba de la base (se ensayan en la copia de ensayo del VPS).
3. Ninguna fase suma candados. Si una fase lo pide, está mal hecha.

## Ya resuelto

`findCloudLoanTwin`, `withCloudLedger`, `keepRenewedLoanClosed`: no existen en el código ni en las reglas `.cursor`.

## Plan limpieza Fase 1 (19/10 — solo assert, sin tocar runtime)

**Regla:** un commit aparte, reversible, de noche con rutas cerradas. Cero cambio en cobrador/supervisor/API.
Solo se quitan `expect` de **candado** cuya causa ya cubre la base. Las **reglas** se quedan.

| Lote | Qué | ¿Se toca? | Nota |
| --- | --- | --- | --- |
| **1a** | §16 candados Albornoz «no rehace fichas / no da de baja copias» (~6) | **HECHO 19/10** | Quitados del assert; sync nube (drop / loan_missing) se quedó como regla |
| **1b** | §26 renglón GAS- / rename | **HECHO 19/10 (limpio)** | Nombres de caso genéricos. **Expect se quedan**: el renglón GAS- sigue en el aparato (borrarlos = daño). Borrado funcional → Fase 3 Saldos |
| **1c** | §30 solo los ~4 candados de renovar (no las reglas +20 % / sin plata) | Tercer lote | `renew_loan` ya en base |
| **No tocar aún** | §14 Prestar atendido (~12) | Se queda | Es **regla** de planilla |
| **No tocar aún** | §14 Haber Banco Albornoz (~39) | Se queda | Mezcla Fase **3 Saldos** |
| **No tocar aún** | §16 `activeLoans` / un préstamo por cliente (~15) | Se queda | Es **regla** (también en UI) |
| **No tocar aún** | §30 reglas renovar (~14) | Se queda | Negocio: sin plata, +20 % |

Orden: **1a → assert OK en taller → commit → release de noche**. Luego 1b, luego 1c.
Prohibido mezclar limpieza con Fase 2/3/4 en el mismo commit.
