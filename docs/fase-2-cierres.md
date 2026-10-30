# Fase 2 — Cierre = orden al servidor (diseño, 09/10)

Estado: supersedido por **`docs/fase-4-cierres.md`** (Fase 4 dueño del dato).  
La etapa 2a (sombra `planServerSheetClose`) sigue en código; el corte que escribe es 4.1.

## Hoy (aparato dueño del saldo)

1. El celular calcula el saldo del día con **su copia** (`sealCollectorDay` local).
2. Sube el CIE- / PCE- y las visitas selladas como filas enteras.
3. El servidor se defiende con candados: `cloud_cie_past_day_sealed`,
   `cloud_cie_keeps_cash_float` (gana el más fresco), `cie_reopened`,
   `missingPriorDayCie`, `keepSealedCashFloat`, «auto-cierre del aparato no sella»,
   reconcile que sube CIE- huérfanos, hoja abierta que no pisa la cerrada.

Cada candado frena un caso; el aparato sigue siendo el dueño. Así nacieron el 2.090.000,
el 12.271.000 vs 9.410.000 y la T de Edgar cerrada con M.

## Medición (09/10, solo lectura)

El servidor recalculó, con los datos de la nube y el mismo motor del corte 23:30, cada CIE-
sellado desde el 25/09 (24 cierres):

| Caso | Resultado |
| --- | --- |
| Cadena M/T (Cristian / Edgar) desde el 29/09 | Igual al guardado |
| Cristian 25, 26 y 28/09 | Distinto: días corregidos a mano (caso 2.704.000), historia |
| Yesid (N) 30/09 – 06/10 | Distinto: se sellaban con la fórmula vieja (saldo negativo); historia |
| Yesid 07/10 | 10.000 de diferencia: un cobro de 10.000 cambió después del cierre (CIE dice 1.964.000 cobrado, la nube hoy 1.954.000) |
| 08/10 (todos) | Igual |

Conclusión: el motor del servidor ya da la cifra correcta con la nube completa. Falta que
**sea el único** que sella. La historia no se recalcula (los días distintos quedan como están).

## Destino (servidor dueño del cierre)

| Paso | Qué pasa |
| --- | --- |
| 1 | El cobrador toca «Cerrar M / T / N / A». El aparato primero sube su cola (cobros, gastos, visitas) con `await`. Si queda algo sin subir → «subiendo cobros…», no manda el cierre |
| 2 | Manda una orden: `{ op: "close_sheet", collectorRef, date, route, key, by }` a `/api/ops/close-sheet` |
| 3 | El servidor carga de la nube ese cobrador y ese día (más el CIE- de ayer) y corre `sealCollectorDay` |
| 4 | Revisa: es hoy (Bogotá) · T no antes que M · existe el CIE- de ayer · no está ya sellado · no hay reapertura en conflicto |
| 5 | Una función en la base `seal_day_close(...)` escribe en **una sola transacción**: CIE- (o PCE-), visitas de esa hoja con `day_closed_at`. Misma `key` = mismo cierre (reintento sin duplicar) |
| 6 | Contesta el CIE- / PCE- / visitas. El aparato los adopta. **El aparato nunca más sube un `cash_float`** |

- Sin señal: el cierre queda «pendiente de cierre» en la cola y se manda al volver la red.
  Si llega 23:30 sin enviarse, el corte del servidor lo sella con el mismo motor.
- Corte 23:30 (`/api/ops/day-rollover`) y revisión 6:00: misma función `seal_day_close`.
- Reabrir hoja de hoy: ya es del servidor (`/api/ops/reopen-sheet`); pasa a una función de la base.
- Ajuste de saldo real (T, A/N, pools): orden `adjust_day_cash` (fase 2b).
- Aparato con versión vieja que sube un CIE-: se convierte en orden (como `legacyLoanCommand`):
  el servidor **ignora** su `cash_float` y sella con su propio cálculo.

## Etapas

| Etapa | Qué | Cuándo |
| --- | --- | --- |
| 2a | Taller: `/api/ops/close-sheet`, `seal_day_close` (migración), orden en la cola del aparato. Pruebas sin escritura: el servidor calcula el cierre de hoy y se compara con lo que sellaría el celular | De día, sin publicar |
| 2b | Publicar de noche con rutas cerradas. Conviven: aparato nuevo manda orden; viejo se convierte en orden | Noche |
| 2c | Cerrar escritura directa en `day_closes` y en `day_closed_at`. Quitar los candados de la lista de arriba (cada uno, con su sección de `assert-cash-chain.mjs`) | Cuando todos los aparatos estén en la versión nueva |

## Necesita

- Token nuevo de Supabase (la función `seal_day_close` y los permisos van en la base).
- Cierre sin señal = «pendiente de cierre» (aprobado por el dueño, 09/10).
- Paso 3 de la Fase 1 hecho antes (préstamos cerrados en la base).
