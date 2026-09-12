# Dinero operativo — contrato vivo (demo → backend)

**Estado:** vigente en `apps/admin` (demo localStorage).  
**Objetivo:** que el sistema crezca grande sin que Cobranza, Banco y Cobros diarios se peleen.

Este documento es la **raíz de dinero** mientras no exista API + PostgreSQL oficiales (`architecture.md`).

---

## 1. Fuente de verdad

| Capa | Qué es | Quién manda |
| --- | --- | --- |
| **Pagos** `PaymentRow` (`PG-`) | Cobros reales | **Raíz** |
| **Planilla** `DailyCollectionAssignment` | Visitas del día | Derivada de pagos + reglas de visita |
| **CIE** `CollectorDayCloseRecord` | Cierre de jornada | `collected` / `cashFloat` derivados de pagos |
| **Banco** `BankMovement` | Debe/Haber | Proyectado desde pagos + gastos CIE/draft + varios |
| **Logs diarios** | Resumen por cobrador/día | Alineados a pagos |

Regla dura: **si un número de plata no cuadra, se corrige desde `PG-`, no al revés.**

---

## 2. Proyección única

Tras **cualquier** mutación de dinero o cierre, el código debe pasar por:

```ts
synchronizeOperationalState(...)  // apps/admin/lib/operational-sync.ts
```

Eso alinea en una pasada:

1. Préstamos (saldo / alerta / mora)  
2. CIE.collected + cashFloat  
3. Banco (Debe = PG-, Haber = gastos)  
4. Planilla (visitas cobradas)  
5. Logs diarios.collected  

Banco también puede proyectarse solo con `syncBankLedger` / `applyBankLedgerSync` cuando el resto del estado no cambia.

---

## 3. Caminos canónicos (no inventar otros)

| Acción | Entrada | Debe terminar en |
| --- | --- | --- |
| Cobro calle | `commitCollectorPayment` | pagos + planilla + `syncBankLedger` (+ log) |
| Cobro caja oficina | `registerPay` (Workspace) | pagos + `reconcilePaymentsOntoPlanilla` + efecto banco |
| Gastos ruta | `upsertDayExpenseDraft` | drafts + `syncBankLedger` |
| Cerrar día (móvil / admin / 23:30) | `finalizeCollectorDayClose` + `closeDispatchDay` | CIE + planilla sellada + banco |
| Hydrate / pestaña | `hydrateOperationalDemo` | ciclo día + `synchronizeOperationalState` |

Prohibido: cerrar solo la planilla sin CIE, o meter plata al banco sin `PG-`.

---

## 4. Orígenes (demo)

| Origen | Store |
| --- | --- |
| `localhost:3000` | localStorage de ese Chrome |
| `prestamo-y-cobranza.vercel.app` | localStorage de ese dispositivo |

No se sincronizan entre sí. El push de Git **no borra** cobros del celular (salvo bootstrap nuevo o borrar datos del sitio).

Retención: **30 días** de historial operativo (`data-retention.ts`). Maestros (clientes, préstamos) se conservan.

---

## 5. Smoke checklist (2–3 min)

En **un solo origen** (local o Vercel):

1. Entrar como cobrador → cobrar a un cliente de planilla.  
2. Truqui → **Cobranza / Pagos** y **Banco / Registros**: mismo monto Debe.  
3. Truqui → **Cobranza / Cobros del día**: visita cobrada.  
4. Cerrar día (móvil o admin) → existe CIE; gastos en Haber si hubo.  
5. Login `build` = SHA de `origin/main` tras cada push (`npm run verify:prod` + purge).

Si falla un paso: corregir la proyección, no “parchear” la pantalla.

---

## 6. Crecimiento hacia backend (fase C)

Orden profesional:

1. Mantener este contrato en demo.  
2. Tabla `payments` (y luego cierres / movimientos) en Supabase con la **misma semántica**.  
3. API escribe pagos; clientes solo leen proyecciones.  
4. Apagar localStorage como fuente de dinero.

Hasta entonces: este archivo + `operational-sync.ts` son la ley.
