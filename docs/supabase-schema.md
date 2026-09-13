# Esquema Supabase — dominio completo (nivel alto)

**Proyecto:** `connkdwezlwqlwgjerav`  
**Estado:** C6 foundation — catálogo + dinero + CIE + planilla + perfiles  
**Dinero:** `NUMERIC` · **App:** mirror/pull (`payment-mirror`, `catalog-mirror`, `ops-mirror`)

---

## Diagrama ER completo

```mermaid
erDiagram
  PROFILES ||--o| COLLECTORS : "collector_ref"
  COLLECTORS ||--o{ ROUTES : "collector_ref"
  CLIENTS ||--o{ LOANS : "client_ref"
  LOANS ||--o{ PAYMENTS : "loan_ref"
  CLIENTS ||--o{ PAYMENTS : "client_ref"
  COLLECTORS ||--o{ DAY_CLOSES : "CIE"
  COLLECTORS ||--o{ DAY_EXPENSES : "gastos"
  COLLECTORS ||--o{ DAILY_ASSIGNMENTS : "planilla"
  LOANS ||--o{ DAILY_ASSIGNMENTS : "loan_ref"
  PAYMENTS ||--o| DAILY_ASSIGNMENTS : "payment_ref"
  MISC_PAYMENTS }o--|| BANK_PROJECTION : "PV- → banco app"

  CLIENTS {
    text ref UK "COD-"
    text name
    text route
    numeric total
    numeric pending
  }
  LOANS {
    text ref UK "P-"
    text client_ref
    numeric capital
    numeric paid
    numeric balance
  }
  PAYMENTS {
    text ref UK "PG- RAÍZ PLATA"
    text loan_ref
    numeric amount
    date paid_date
  }
  COLLECTORS {
    text ref UK "COB-"
    text name
    boolean active
  }
  ROUTES {
    text ref UK
    text collector_ref
    text name
    jsonb stops
  }
  DAY_CLOSES {
    text ref UK "CIE-"
    date close_date
    numeric collected
    numeric cash_float
  }
  DAY_EXPENSES {
    text ref UK
    date expense_date
    jsonb expenses
  }
  DAILY_ASSIGNMENTS {
    text item_id
    date dispatch_date
    text visit_status
    text payment_ref
  }
  MISC_PAYMENTS {
    text ref UK "PV-"
    numeric amount
  }
  PROFILES {
    uuid id PK "auth.users"
    text login
    text collector_ref
    text role_id
  }
```

---

## UML dominio

```mermaid
classDiagram
  direction TB
  class Client
  class Loan
  class Payment {
    <<raíz de dinero>>
  }
  class Collector
  class Route
  class DayClose {
    <<CIE>>
  }
  class DayExpense
  class Assignment {
    <<planilla>>
  }
  class MiscPayment {
    <<PV- oficina>>
  }
  class Profile {
    <<Auth bridge>>
  }
  class ProyeccionesApp {
    <<no tabla raíz>>
    Banco
    LogsDiarios
  }

  Client "1" --> "*" Loan
  Loan "1" --> "*" Payment
  Collector "1" --> "*" Route
  Collector "1" --> "*" DayClose
  Collector "1" --> "*" DayExpense
  Collector "1" --> "*" Assignment
  Loan "1" --> "*" Assignment
  Payment ..> Assignment : alinea visita
  Payment ..> ProyeccionesApp : proyecta
  MiscPayment ..> ProyeccionesApp : proyecta
  Profile --> Collector : opcional
```

---

## Quién manda (nada suelto)

| Capa | Tablas | Rol |
| --- | --- | --- |
| Personas | `clients` | COD- |
| Contratos | `loans` | P- |
| **Plata** | `payments` | **PG- raíz** |
| Campo | `collectors`, `routes` | COB- / RUT- |
| Jornada | `day_closes`, `day_expenses` | CIE- / gastos |
| Planilla | `daily_assignments` | visitas del día |
| Oficina | `misc_payments` | PV- |
| Auth | `profiles` | uid → login / rol |
| Proyección app | — | Banco + logs desde PG- + CIE + PV- |

---

## Migraciones

1. `…150000_payments.sql`  
2. `…160000_clients_loans.sql`  
3. `…210000_schema_harden_ops.sql`  
4. `…220000_ops_complete.sql` ← dominio completo + `v_ops_overview`

---

## Sync en la app

| Módulo | Código |
| --- | --- |
| Cobros | `payment-mirror` |
| Clientes / préstamos | `catalog-mirror` |
| Ops (CIE, rutas, …) | `ops-mirror` + `/api/ops/*` |
| Orquestación | `useOperationalDemoSync` |

---

## Siguiente (C6.1)

1. Usuarios Auth para cada cobrador + filas en `profiles`  
2. Quitar políticas `anon`  
3. FK físicas tras backfill  
4. Realtime en `payments` / `day_closes`
