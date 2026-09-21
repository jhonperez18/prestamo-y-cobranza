# Camino demo → backend (fase C → C6)

**Estado:** C6 foundation — dominio operativo compartido.  
**Esquema + diagramas:** [`supabase-schema.md`](supabase-schema.md)  
**Dinero:** [`operational-money.md`](operational-money.md)  
**Arquitectura:** [`architecture.md`](architecture.md)

---

## Raíces en Postgres (nada suelto)

| Dominio | Tabla | Clave |
| --- | --- | --- |
| Personas | `clients` | `COD-` |
| Contratos | `loans` | `P-` |
| **Plata** | `payments` | **`PG-`** |
| Cobradores | `collectors` | `COB-` |
| Rutas | `routes` | `RUT-` / `RUT-D-` |
| CIE | `day_closes` | `CIE-` |
| Gastos día | `day_expenses` | — |
| Planilla | `daily_assignments` | `(fecha, item_id)` |
| Oficina PV- | `misc_payments` | `PV-` |
| Auth bridge | `profiles` | `auth.users.id` |

**Proyección en app (no segunda raíz):** banco + logs diarios ← `PG-` + CIE + PV-.

---

## Orden firme

| Paso | Qué |
| --- | --- |
| C0–C4 | Contrato PG- + dual-write + Postgres raíz de cobros |
| C5 | Clientes + préstamos |
| **C6** | CIE, rutas, cobradores, planilla, PV-, profiles listos |
| C6.1 | Auth cobradores + RLS por rol (quitar `anon`) + FK físicas |

---

## Sync en código

1. Mutación local (calle/oficina)  
2. Cola offline si falla red  
3. Al abrir / volver: flush → **subir `PG-` / CIE / gastos / planilla locales que falten** → pull → `hydrateOperationalDemo`  

> **Crítico:** localhost y Vercel no comparten `localStorage`. Si un cobro o un CIE queda solo en el PC, el celular verá otra alerta y otro **saldo de ruta**. El reconcile C4.1/C6.1 cierra ese hueco.

| Módulo | Archivo |
| --- | --- |
| Cobros | `lib/supabase/payment-mirror.ts` |
| Clientes/préstamos | `lib/supabase/catalog-mirror.ts` |
| Ops | `lib/supabase/ops-mirror.ts` + `/api/ops/*` |
| Orquesta | `lib/use-operational-demo-sync.ts` |

Migraciones: `supabase/migrations/20260912*.sql`

CLI (cuando haya link + token):

```bash
npx supabase db push
```

---

## C6.1 (Auth + RLS — en curso)

1. `SUPABASE_SERVICE_ROLE_KEY` solo en servidor (API mirrors) — **obligatorio**; sin fallback anon
2. Políticas `anon` eliminadas en tablas ops
3. `profiles` + login Auth (email) con upsert de perfil
4. Login corto (`juan.rios`) intenta Auth mapeado; si no, demo local
5. Pull de catálogo: cola pendiente gana (no rebobina altas/edits frescos)
6. Cobro `PG-` / CIE: await flush de colas antes de “listo”
7. `verify:prod` falla si `serviceRole` no está en Vercel

Pendiente operativo: crear usuarios Auth en Dashboard y aplicar migración RLS en el proyecto Supabase.
