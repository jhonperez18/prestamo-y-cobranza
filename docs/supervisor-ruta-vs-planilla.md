# Supervisor — Hoja Ruta (vista)

**Estado:** En taller (31/10) · **solo vista** (cero cambio de lógica de cobro / caja / CIE / INICIO).  
**Pedido dueño:** 31/10/2026 — una sola hoja **RUTA**; sin botón Planilla (no doble).

## Meta

| Qué | Cómo |
| --- | --- |
| Nace | La misma hoja del día que ya genera el sistema para el cobrador |
| Día a día | Se marca lo que el cobrador hace (cobró, N/P, prestó, V, Prestar…) en vivo |
| Mejoras | Etiqueta **V** (vencido), **Prestar**, señales del cobrador |
| Botón Planilla | **Quitado** — no reabrir sin pedido |
| Historial | Aparte; no es el duplicado |

## Contrato

1. **Solo vista.** No tocar cobro / CIE / Inicial / armado 00:00.
2. **INICIO intacto** (tarjetas, saldos, pins).
3. Misma fuente: `daily_assignments` del día.
4. Prestar solo en **Ruta** (mismo `onCreateQuickLoan`).
5. Hoja diaria sellada: no prestar en Recaudo.

## Cortes

| Corte | Estado |
| --- | --- |
| A Inventario (Prestar era la única salida de Planilla) | **HECHO** |
| B Ruta = lista + V + Prestar | **HECHO** taller |
| C Sin botón Planilla; solo RUTA | **HECHO** taller |

### Dónde está la hoja

| Sitio | Ahora |
| --- | --- |
| Menú **RUTA** (al lado de INICIO) | **Única** entrada · hoja viva + V + Prestar · pin de la ruta si venía de una ficha |
| INICIO → ficha | Cuadre / Gastos / Cobros / … · **sin** botón RUTA (no doble) |
