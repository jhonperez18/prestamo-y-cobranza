# Modelo de datos inicial

**Estado:** propuesta para revisión. No ejecutar en Supabase todavía.

Reglas:

- El cliente es único. Un préstamo no crea otra persona.
- Los pagos no se borran; se anulan.
- Las condiciones del préstamo se guardan en `loan_terms` y no se reescriben si cambia la configuración global.
- El dinero usa `NUMERIC`. Precisión exacta: pendiente del comprador.

---

## Tablas propuestas

| Tabla | Propósito |
| --- | --- |
| `users` | Perfil de negocio (1:1 con `auth.users`) |
| `roles` | Catálogo de roles |
| `permissions` | Catálogo de permisos |
| `role_permissions` | N:N rol–permiso |
| `user_roles` | N:N usuario–rol |
| `collectors` | Perfil de cobrador (zona, estado) |
| `customers` | Entidad central |
| `customer_references` | Referencias personales |
| `customer_addresses` | Domicilios (uno puede ser principal) |
| `loans` | Contratos |
| `loan_terms` | Snapshot inmutable de condiciones |
| `installments` | Cuotas |
| `payments` | Transacción de dinero |
| `payment_allocations` | Cómo un pago se reparte en cuotas |
| `payment_voids` | Anulación (quién, por qué, cuándo) |
| `routes` | Rutas de cobranza |
| `route_stops` | Cliente + orden de visita |
| `files` | Metadatos de Storage |
| `signatures` | Firma ligada a una operación |
| `locations` | Punto GPS de una operación |
| `evidence_items` | Evidencia ligada a operación |
| `idempotency_keys` | Anti-duplicado |
| `audit_events` | Auditoría append-only |
| `settings` | Configuración futura (no histórica de préstamos) |

No hay tabla `prospects` aparte: un prospecto es un `customer` con `status = prospect` o `pending_review`. Evita duplicar personas.

---

## Relaciones

```
auth.users.id ──1:1── users.auth_user_id

users ──* user_roles *── roles *── role_permissions *── permissions
users ──1:1── collectors          (si el usuario es cobrador)

customers.created_by → users
customers ──* customer_references
customers ──* customer_addresses
customers ──* loans
customers.photo_file_id → files

loans.customer_id → customers
loans.created_by → users
loans ──1:1── loan_terms
loans ──* installments
loans ──* payments

installments.loan_id → loans

payments.loan_id → loans
payments.customer_id → customers     (denormalizado controlado, para consultas)
payments.collector_id → collectors
payments.created_by → users
payments ──* payment_allocations → installments
payments ──0..1 payment_voids
payments ──* evidence_items
payments ──0..1 signatures
payments ──0..1 locations

routes.collector_id → collectors
routes ──* route_stops → customers
```

---

## Estados propuestos (ajustables)

**Cliente:** `prospect` · `pending_review` · `active` · `inactive` · `rejected`

**Préstamo:** `draft` · `active` · `paid_off` · `cancelled` · `refinanced`  
(`defaulted` u otros: pendiente del comprador)

**Cuota:** `pending` · `partial` · `paid` · `overdue` · `cancelled` · `rescheduled`

**Pago:** `completed` · `voided`

**Ruta:** `draft` · `scheduled` · `in_progress` · `closed`

---

## Campos mínimos de dinero (pago)

Un pago registra el **valor recibido**. El motor escribe las asignaciones.

```
payments
  id, customer_id, loan_id
  collector_id, created_by
  amount_received          NUMERIC
  method                   (cash | transfer | other — pendiente)
  status
  note
  occurred_at
  created_at, updated_at
  idempotency_key          UNIQUE
```

```
payment_allocations
  payment_id, installment_id
  amount_capital, amount_interest, amount_late_fee, amount_total
```

Los desgloses capital/interés/mora **se dejan en el modelo** pero se llenan a 0 o se omiten hasta que existan fórmulas aprobadas. No se inventan.

---

## Índices iniciales (solo caminos reales)

| Índice | Sobre |
| --- | --- |
| documento del cliente | `customers.document_number` (único si el comprador lo exige) |
| teléfono | `customers.phone` |
| estado cliente | `customers.status` |
| préstamos por cliente | `loans(customer_id, status)` |
| cuotas por préstamo y fecha | `installments(loan_id, due_date)` |
| cuotas vencidas | `installments(status, due_date)` |
| pagos por fecha | `payments(occurred_at)` |
| pagos por cobrador | `payments(collector_id, occurred_at)` |
| paradas de ruta | `route_stops(route_id, visit_order)` |
| idempotencia | `idempotency_keys(key)` UNIQUE |
| auditoría por entidad | `audit_events(entity_type, entity_id, created_at)` |

Único de documento: **pregunta al comprador**. Si dos personas no pueden compartir cédula, UNIQUE. Si hay extranjeros sin documento aún, el UNIQUE debe ser parcial.

---

## Dinero

Propuesta temporal (no definitiva):

- Tipo: `NUMERIC(18,2)`
- Moneda: COP (confirmar)
- Zona horaria: `America/Bogota` (confirmar)
- Redondeo: no definido. El motor no redondeará “como le parezca”.

Prohibido: `float4`, `float8`, `money` de PostgreSQL, `number` de JavaScript como saldo oficial.

---

## Auditoría de esquema

Cada cambio = nueva migración en `/supabase/migrations/` con nombre secuencial:

```
001_extensions.sql
002_users_roles.sql
003_customers.sql
004_loans_installments.sql
005_payments.sql
006_routes.sql
007_evidence_files.sql
008_audit_idempotency.sql
```

Nombres definitivos al aprobar el ER.

---

## Fuera de este modelo (a propósito)

- Fórmulas de interés
- Tabla de mora calculada
- Multi-empresa (`organization_id`) — se puede añadir como columna después si la respuesta es sí; más barato decidirlo ahora
- Billetera / saldo a favor — se añade si la regla de sobrepago lo exige
