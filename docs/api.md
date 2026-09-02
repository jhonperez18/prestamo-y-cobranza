# API — contratos iniciales

Prefijo: `/v1`  
Formato: JSON  
Auth: Bearer (Supabase) en todas las rutas salvo login/refresh.

La API es el único lugar que muta dinero. El admin y la PWA no calculan saldos oficiales.

---

## Convenciones

- Identificadores: UUID.
- Listados: paginados. Query `limit` (máx. 50) + `cursor` o `page`.
- Errores: `{ "code": "PAYMENT_DUPLICATE", "message": "…" }`
- Fechas: ISO-8601 UTC. La UI muestra zona del negocio.
- Mutaciones financieras: cabecera `Idempotency-Key` obligatoria.

Códigos de ejemplo (no exhaustivo):

| code | HTTP | Cuándo |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Sin sesión |
| `FORBIDDEN` | 403 | Sin permiso o recurso ajeno |
| `NOT_FOUND` | 404 | No existe o no es visible |
| `VALIDATION_ERROR` | 422 | Cuerpo inválido |
| `DUPLICATE_CUSTOMER` | 409 | Posible duplicado de persona |
| `PAYMENT_DUPLICATE` | 409 | Idempotencia |
| `RULE_NOT_DEFINED` | 409 | Sobrepago u otra regla sin aprobar |
| `RATE_LIMITED` | 429 | Abuso |

---

## Módulos

### Auth

```
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/me
```

`/me` devuelve usuario, roles y permisos **efectivos**. El frontend los usa para pintar; el servidor los vuelve a comprobar.

### Users / roles

```
GET    /v1/users
POST   /v1/users
PATCH  /v1/users/:id
POST   /v1/users/:id/deactivate
GET    /v1/roles
PUT    /v1/roles/:id/permissions
```

### Customers

```
GET    /v1/customers
POST   /v1/customers
GET    /v1/customers/:id
PATCH  /v1/customers/:id
POST   /v1/customers/:id/review      body: { decision: approve|reject|need_info }
GET    /v1/customers/:id/loans
GET    /v1/customers/:id/history
GET    /v1/customers/duplicates      query: document, phone
```

`POST /customers` desde PWA crea con `status = pending_review` salvo que el permiso sea administrativo.

Antes de crear: búsqueda de duplicados. Si hay match, respuesta `409 DUPLICATE_CUSTOMER` con los candidatos. El cliente UI muestra advertencia. Un administrador puede forzar con flag explícito y queda auditado.

### Loans / installments

```
GET    /v1/loans
POST   /v1/loans
GET    /v1/loans/:id
GET    /v1/loans/:id/statement       estado de cuenta
GET    /v1/loans/:id/installments
```

`POST /loans` congela `loan_terms` en el mismo insert. No lee “la config de hoy” en cada consulta futura.

### Payments

```
GET    /v1/payments
POST   /v1/payments
GET    /v1/payments/:id
POST   /v1/payments/:id/void
```

`POST /v1/payments` (cuerpo mínimo):

```json
{
  "loan_id": "uuid",
  "amount_received": "5000.00",
  "method": "cash",
  "occurred_at": "2026-08-27T15:32:00-05:00",
  "note": "",
  "location": { "lat": 4.65, "lng": -74.08, "accuracy_m": 12 },
  "signature_file_id": "uuid",
  "evidence_file_ids": ["uuid"]
}
```

El servidor:

1. Verifica sesión, permiso `pagos.registrar`, asignación del cliente al cobrador (si aplica).
2. Bloquea el préstamo.
3. Llama al motor financiero.
4. Persiste pago + asignaciones + auditoría.
5. Devuelve estados oficiales de cuota y préstamo.

Si `amount_received` supera lo definido por las reglas **aún no aprobadas**, responde `RULE_NOT_DEFINED` y no inventa el comportamiento.

### Routes / collectors

```
GET    /v1/routes
POST   /v1/routes
GET    /v1/routes/:id
POST   /v1/routes/:id/stops
GET    /v1/routes/today              (PWA: la ruta del usuario)
GET    /v1/collectors
```

`/routes/today` no lista la cartera global.

### Files / evidence

```
POST /v1/files/signed-upload
POST /v1/files/:id/complete
GET  /v1/files/:id/signed-url
```

Subida: el cliente pide URL firmada, sube al bucket, confirma. El binario no pasa por la API.

### Reports / audit / settings

```
GET /v1/reports/daily-collections
GET /v1/reports/portfolio
GET /v1/audit
GET /v1/settings
PATCH /v1/settings                 (no reescribe préstamos viejos)
```

---

## Autorización en cada request

Orden fijo:

1. ¿Hay sesión válida?
2. ¿El rol tiene el permiso de la ruta?
3. ¿El recurso es visible para ese usuario? (ruta, cliente asignado, etc.)
4. ¿La operación es idempotente si aplica?

Ocultar un botón en el admin no es autorización.
