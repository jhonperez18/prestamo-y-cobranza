# Esquema Supabase — operativo (claro y manejable)

**Proyecto:** `connkdwezlwqlwgjerav`  
**Estado:** C5 endurecido — tres tablas raíz + vistas de lectura  
**Dinero:** siempre `NUMERIC`, nunca float  
**App:** dual-write / pull desde `apps/admin` (`payment-mirror`, `catalog-mirror`)

---

## Diagrama ER (entidad–relación)

```mermaid
erDiagram
  CLIENTS ||--o{ LOANS : "tiene"
  LOANS ||--o{ PAYMENTS : "recibe"
  CLIENTS ||--o{ PAYMENTS : "opcional client_ref"

  CLIENTS {
    uuid id PK
    text ref UK "COD-…"
    text name
    text last_name
    text document
    text route
    int route_order
    numeric total
    numeric pending
    text status
    bool awaiting_loan
    bool profile_pending
    timestamptz created_at
    timestamptz updated_at
  }

  LOANS {
    uuid id PK
    text ref UK "P-…"
    text client_ref "→ CLIENTS.ref"
    text client_name
    text start_date
    text due_date
    numeric capital
    numeric paid
    numeric balance
    text frequency
    text mode
    numeric installment
    jsonb schedule
    int collection_alerts
    timestamptz created_at
    timestamptz updated_at
  }

  PAYMENTS {
    uuid id PK
    text ref UK "PG-… raíz plata"
    text loan_ref "→ LOANS.ref"
    text client_ref "→ CLIENTS.ref"
    numeric amount
    date paid_date
    text method "efectivo|nequi"
    text source "ruta|pwa|caja|oficina"
    text collector_ref
    text route_ref
    timestamptz created_at
    timestamptz updated_at
  }
```

---

## Diagrama UML (clases / dominio)

```mermaid
classDiagram
  direction TB

  class Client {
    +ref: COD-…
    +name
    +route
    +routeOrder
    +total: NUMERIC
    +pending: NUMERIC
    +awaitingLoan
    +profilePending
  }

  class Loan {
    +ref: P-…
    +clientRef
    +capital: NUMERIC
    +paid: NUMERIC
    +balance: NUMERIC
    +frequency
    +mode
    +installment
    +schedule: JSON
  }

  class Payment {
    +ref: PG-…
    +loanRef
    +clientRef
    +amount: NUMERIC
    +paidDate
    +method
    +source
    <<raíz de dinero>>
  }

  class Proyecciones {
    <<app, no tabla raíz>>
    Planilla
    CIE
    Banco
  }

  Client "1" --> "*" Loan : client_ref
  Loan "1" --> "*" Payment : loan_ref
  Client "1" --> "*" Payment : client_ref opcional
  Payment ..> Proyecciones : sincroniza / proyecta
```

---

## Quién manda

| Tabla | Clave negocio | Manda en |
| --- | --- | --- |
| `clients` | `COD-…` | Ficha, ruta, orden |
| `loans` | `P-…` | Condiciones del préstamo |
| `payments` | `PG-…` | **Toda la plata** |

Proyecciones (aún no tablas raíz): planilla, CIE, banco → se calculan en la app desde `PG-`.

Vistas SQL de apoyo: `v_loans_enriched`, `v_payments_enriched` (solo lectura).

---

## Migraciones (orden)

1. `20260912150000_payments.sql` — crea `payments` + RLS  
2. `20260912160000_clients_loans.sql` — crea `clients` + `loans` + RLS  
3. `20260912210000_schema_harden_ops.sql` — checks, índices, triggers `updated_at`, vistas

---

## Convenciones

- **refs** con prefijo: `COD-` / `P-` / `PG-` (CHECK en SQL)
- **Dinero:** `numeric(14,2)`
- **Tiempo de fila:** `created_at` / `updated_at` (UTC, trigger en UPDATE)
- **RLS:** `authenticated` + `anon` temporal (quitar anon en C6 con auth real)
- **Sin FK físicas aún** entre tablas: el dual-write puede llegar desordenado; la relación es lógica (`client_ref`, `loan_ref`). FK estrictas = C6.

---

## Qué toca la app

| Acción | Tabla |
| --- | --- |
| Cobrar | `payments` (+ actualiza espejo `loans` / `clients`) |
| Alta/edita cliente | `clients` |
| Alta/edita/renueva préstamo | `loans` |

localStorage = caché + cola offline. Postgres manda al hacer pull.

---

## Siguiente endurecimiento (C6)

1. Auth Supabase + RLS por rol (quitar `anon`)  
2. FK `loans.client_ref → clients.ref` y `payments.loan_ref → loans.ref`  
3. Fechas `date` puras (hoy parte sigue en texto demo)  
4. Tablas de proyección opcionales: `day_closes`, `routes` si dejan de ser solo local
