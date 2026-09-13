# Camino demo → backend (fase C)

**Estado:** C5 — sync cobros + clientes + préstamos. Esquema endurecido: [`supabase-schema.md`](supabase-schema.md).  
**Contrato de dinero:** [`operational-money.md`](operational-money.md)  
**Arquitectura:** [`architecture.md`](architecture.md)

---

## Qué quedó unificado

| Entidad | Tabla Supabase | Comportamiento |
| --- | --- | --- |
| Cobros `PG-` | `public.payments` | Raíz de plata (C4) |
| Clientes `COD-` | `public.clients` | Dual-write + pull (C5) |
| Préstamos `P-` | `public.loans` | Dual-write + pull (C5) |

Celular y PC (mismo Vercel o localhost con env) comparten esas tres raíces.  
Planilla / CIE / banco se **re-proyectan** desde pagos al hidratar (no hace falta otro ledger).

---

## Orden hecho

| Paso | Qué |
| --- | --- |
| C0–C1 | Contrato PG- + SQL payments |
| C2–C4 | Dual-write, pull, Postgres raíz de cobros + cola offline |
| **C5** | Clientes y préstamos igual (mirror + pull + cola) |

---

## C5 — reglas

1. Alta/edición/renovación/calle → `queueClientMirror` / `queueLoanMirror`
2. Al abrir / volver: flush colas → pull payments + clients + loans → hidratar
3. Remoto manda por `ref`; offline local se conserva hasta subir
4. Auth/RLS `anon` temporal hasta C6

Código: `lib/supabase/catalog-mirror.ts`, `GET|POST /api/clients*`, `/api/loans*`, `useOperationalDemoSync`

Migración: `supabase/migrations/20260912160000_clients_loans.sql`

---

## Siguiente (crecimiento)

- C6: login Supabase + RLS por rol (quitar anon)
- Catálogo (rutas/cobradores/usuarios) si hace falta multi-oficina
- Offline robusto / realtime
