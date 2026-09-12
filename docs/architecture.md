# Arquitectura inicial — Sistema de préstamos y cobranza

**Versión:** 0.1 — para revisión y aprobación  
**Fecha:** 2026-08-27  
**Estado:** no implementar el producto hasta aprobar este documento

Este documento cumple la primera fase obligatoria. No crea tablas definitivas, no inventa fórmulas financieras y no construye la aplicación completa.

El enfoque visual del admin (botones arriba + variantes a la izquierda) está en [`ui-navigation.md`](ui-navigation.md). La app vive en `apps/admin`.

**Demo actual (antes de API):** la raíz de dinero operativa está en [`operational-money.md`](operational-money.md) — pagos `PG-` mandan; Cobranza / Banco / CIE se proyectan juntos.

---

## 1. Arquitectura general

Tres componentes, una sola fuente de verdad.

```
┌─────────────────────────────────────────────────────────┐
│  ADMIN (navegador / escritorio)                         │
│  Barra superior → Sidebar izquierdo → Módulo / vista    │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / JSON
                            ▼
┌─────────────────────────────────────────────────────────┐
│  API  (núcleo lógico)                                   │
│  Auth · Permisos · Validación · Motor financiero        │
│  Idempotencia · Auditoría · Orquestación Storage        │
└───────────────┬──────────────────────────┬──────────────┘
                │                          │
                ▼                          ▼
     PostgreSQL (Supabase)        Storage (Supabase)
     datos + integridad           fotos, firmas, docs
                ▲
                │ HTTPS / JSON
┌───────────────┴──────────────┐
│  PWA cobradores (móvil)      │
│  Consume la misma API        │
│  No calcula saldos oficiales │
└──────────────────────────────┘
```

Reglas duras:

- PostgreSQL + backend son la fuente oficial.
- El admin y la PWA son interfaces. No tienen lógica financiera propia.
- Un cliente es una entidad única. Los préstamos se relacionan con él; no se duplica la persona.
- Cada préstamo conserva sus condiciones históricas. Cambiar configuración futura no reescribe préstamos viejos.
- No se avanza de fase sin revisión cuando el cambio toque dinero, seguridad o modelo de datos.

---

## 2. Tecnologías propuestas

| Capa | Tecnología | Notas |
| --- | --- | --- |
| Lenguaje | TypeScript (estricto) | Un solo lenguaje en admin, PWA, API y motor |
| Admin | Next.js (App Router) | Escritorio, SEO no es prioridad; sí lo son rutas, auth y rendimiento |
| PWA | Vite + React | Más liviana en móvil; mismo diseño de componentes compartidos |
| API | Fastify | Núcleo de negocio separado del frontend. No meter el motor financiero dentro de Next.js |
| Motor financiero | Paquete `packages/financial-engine` | Única capa que calcula y aplica dinero |
| Base de datos | PostgreSQL 15+ vía Supabase | Integridad, índices, transacciones, RLS |
| Auth | Supabase Auth | Sesiones, recuperación, MFA posterior |
| Archivos | Supabase Storage | Firmas, fotos, evidencias. URLs firmadas |
| Validación | Zod | Contratos compartidos API ↔ clientes |
| Acceso SQL | Kysely o Drizzle | SQL tipado. Evitar ORM opaco en dinero |
| Monorepo | pnpm workspaces | `apps/admin`, `apps/pwa`, `packages/*` |
| Migraciones | Supabase CLI + SQL versionado | Nada de tablas “a mano” en el dashboard |
| Dinero | `NUMERIC` PostgreSQL | Nunca `float` / `number` JS para saldos oficiales |
| Observabilidad | Logs estructurados + tabla `audit_events` | Quién / qué / cuándo / sobre qué |

---

## 3. Justificación de cada tecnología

**TypeScript.** Producto de largo plazo. El dinero no admite tipos débiles.

**Admin en Next.js y PWA en Vite.** El admin necesita densidad, tablas y fichas. La PWA necesita arranque rápido, botones grandes y captura de cámara/GPS. Separarlos evita que el panel administrativo se vuelva la app de campo.

**API Fastify independiente.** Las reglas de negocio, la idempotencia y el motor financiero no deben vivir en Server Actions del admin. La PWA y el admin deben pegarle al mismo contrato. Si mañana hay un tercero (contabilidad, WhatsApp), la API ya existe.

**Supabase.** PostgreSQL gestionado, Auth, Storage y RLS en un solo proveedor, con migraciones SQL reales. Encaja con volumen medio-alto sin montar infraestructura el día uno.

**Motor financiero como paquete.** Evita que cada pantalla calcule el saldo a su manera. Admin y PWA solo muestran lo que el servidor responde.

**NUMERIC, no flotante.** Un préstamo de miles de cuotas acumula error de redondeo si se usa IEEE-754.

**Kysely/Drizzle en vez de Prisma para el núcleo.** Se necesita control explícito de transacciones, `SELECT … FOR UPDATE` y funciones SQL. Un ORM que oculte el SQL es un riesgo en cartera.

---

## 4. Diagrama general de flujo

### Cobro en campo (caso central)

```
Cobrador inicia sesión (PWA)
        ↓
API verifica usuario, rol, ruta del día
        ↓
PWA recibe SOLO clientes asignados
        ↓
Cobrador abre cliente → ve cuota informada por el servidor
        ↓
Introduce valor recibido (no calcula saldo)
        ↓
Captura firma + GPS (si corresponde)
        ↓
POST /payments  + Idempotency-Key
        ↓
API: auth → permiso → cliente asignado → motor financiero
        ↓
Transacción PostgreSQL:
  insertar pago
  asignar a cuota(s)
  actualizar estados
  registrar auditoría
  guardar referencias de evidencia
        ↓
Respuesta oficial (pagada / parcial / pendiente)
        ↓
PWA muestra confirmación SOLO si el backend aceptó
```

### Alta de prospecto desde PWA

```
Cobrador → Nuevo cliente → datos + foto + GPS
        ↓
API detecta posibles duplicados (documento / teléfono)
        ↓
Si hay coincidencia: advertencia, no crea el segundo automáticamente
        ↓
Cliente queda en PENDIENTE DE REVISIÓN
        ↓
Admin revisa → aprueba / rechaza / pide información
        ↓
Queda auditado
```

---

## 5. Módulos

Cada módulo tiene frontera clara. El frontend los refleja en la barra superior. El backend los refleja en prefijos de API.

| Módulo | Responsabilidad | No es responsable de |
| --- | --- | --- |
| Auth | Identidad y sesión | Permisos de negocio |
| Usuarios | Cuentas administrativas y de campo | Calcular cartera |
| Roles / permisos | Qué puede hacer cada rol | UI |
| Clientes | Expediente único de la persona | Condiciones del préstamo |
| Préstamos | Contrato y snapshot de condiciones | Recibir el efectivo |
| Cuotas | Calendario del préstamo | Decidir fórmulas |
| Pagos / abonos | Transacciones de dinero | Recalcular a ciegas en el cliente |
| Motor financiero | Aplicar reglas aprobadas | Inventar reglas |
| Cartera | Lecturas agregadas de exposición | Mutar pagos |
| Rutas | Orden de visita y asignación | Crear clientes |
| Cobradores | Perfil operativo de campo | Auth genérica |
| Evidencias | Metadatos de archivos | Binarios en PostgreSQL |
| Reportes | Consultas y exportación | Lógica de cobro |
| Auditoría | Trazas inmutables | Corregir datos |
| Configuración | Parámetros futuros | Reescribir préstamos viejos |

---

## 6–8. Modelo entidad-relación inicial

El cliente es el centro. Un cliente tiene muchos préstamos. Un préstamo tiene muchas cuotas. Un pago es una transacción independiente que se **asigna** a una o más cuotas.

```
users 1───1 collectors
  │
  ├── user_roles ── roles ── role_permissions ── permissions

customers 1──* customer_references
          1──* customer_addresses
          1──* loans
          1──* files (foto de expediente)

loans 1──1 loan_terms          (condiciones históricas, inmutables)
      1──* installments
      1──* payments

payments 1──* payment_allocations → installments
         1──* evidence_items
         1──0..1 signatures
         1──0..1 locations

routes 1──* route_stops → customers
       *──1 collectors

idempotency_keys
audit_events
settings
```

Esto es un **modelo inicial para discusión**, no el esquema definitivo. Las tablas no se crean hasta aprobar [`database.md`](database.md).

---

## 9. PostgreSQL

Principios:

- Claves UUID (`gen_random_uuid()`) para entidades de negocio. Evita enumerar IDs.
- `NUMERIC(18,2)` propuesto para dinero **hasta que el comprador fije moneda, decimales y redondeo**.
- Timestamps en `timestamptz`.
- Soft-delete solo donde haga falta (clientes, usuarios). Los pagos **no se borran**: se anulan.
- Transacciones para cualquier movimiento de dinero.
- `SELECT … FOR UPDATE` sobre préstamo/cuota al registrar pago (evitar carreras entre dos cobradores o un doble tap).
- Índices solo en caminos reales de búsqueda (ver `database.md`).
- Check constraints para estados y montos `>= 0`.
- RLS como capa extra, no como único control. La API también autoriza.

---

## 10. Estrategia Supabase

Usar Supabase como **infraestructura**, no como “backend mágico”.

| Servicio Supabase | Uso |
| --- | --- |
| Postgres | Fuente de verdad |
| Auth | Identidad (email/teléfono, luego MFA) |
| Storage | Archivos privados |
| Migraciones CLI | Única forma de cambiar esquema |
| RLS | Defensa en profundidad |
| Edge Functions | No para el motor financiero |

La API propia habla con Postgres (connection pooler) usando el rol de servicio **solo en servidor**. El navegador nunca recibe la service role key.

Perfiles de usuario: `auth.users` para credenciales; tabla `public.users` para perfil de negocio. No mezclar.

---

## 11. Supabase Storage

Buckets privados, nunca públicos para fotos, firmas ni documentos.

Estructura propuesta (IDs, no nombres de personas):

```
customers/{customer_id}/profile/{file_id}
customers/{customer_id}/documents/{file_id}
loans/{loan_id}/documents/{file_id}
payments/{payment_id}/evidence/{file_id}
payments/{payment_id}/signatures/{file_id}
```

La tabla `files` guarda: id, bucket, path, mime, size, checksum, entidad relacionada, quién subió, cuándo.

Acceso: URL firmada de corta duración. No exponer paths crudos al frontend sin autorización previa.

Compresión y redimensionado **en el cliente antes de subir** (PWA) y validación de tipo/tamaño **en el servidor**.

---

## 12. Autenticación

- Supabase Auth (email + contraseña al inicio).
- Sesiones HTTP-only o token manejado solo por el cliente autorizado; renovación controlada.
- PWA y admin usan el mismo proveedor, distintos clientes OAuth/app.
- Bloqueo de cuenta, rotación, política de contraseña (se define en seguridad).
- El cobrador no obtiene un JWT con “puedo ver todos los clientes”. El token identifica; los permisos y la ruta autorizan.

---

## 13. Roles iniciales

Propuesta de arranque, modificable:

| Rol | Alcance |
| --- | --- |
| `administrador` | Operación completa, usuarios, anulación, configuración |
| `supervisor` | Cartera, rutas, revisión de prospectos, reportes. Sin crear administradores |
| `cobrador` | PWA: su ruta, registrar cobros, alta de prospectos. Sin admin |

Ningún rol implica “ver toda la base” salvo administrador. El cobrador ve únicamente asignados.

---

## 14. Permisos

Autorización por permiso atómico. El frontend oculta botones; el backend **niega** si falta el permiso.

Catálogo inicial (ampliable):

```
clientes.ver
clientes.crear
clientes.editar
clientes.revisar          (aprobar/rechazar prospectos)
prestamos.ver
prestamos.crear
cuotas.ver
pagos.ver
pagos.registrar
pagos.anular
cartera.ver
rutas.ver
rutas.crear
rutas.asignar
cobradores.ver
cobradores.gestionar
usuarios.ver
usuarios.crear
usuarios.editar
roles.gestionar
reportes.ver
auditoria.ver
configuracion.ver
configuracion.editar
```

El cobrador típico: `pagos.registrar`, `clientes.crear` (prospecto), `rutas.ver` (la suya). No `pagos.anular`.

---

## 15. Seguridad

Resumen. Detalle en [`security.md`](security.md).

- HTTPS en todos los entornos públicos.
- Validación Zod en el borde de la API.
- Consultas parametrizadas (el SQL builder las fuerza).
- CORS explícito (orígenes del admin y de la PWA).
- Rate limiting en login y en `POST /payments`.
- Control de acceso horizontal: un cobrador no adivina UUIDs de otros clientes.
- Archivos: allowlist de MIME, techo de tamaño, antivirus posterior si el volumen lo justifica.
- Secretos solo en variables de entorno / vault. Nunca en el frontend.
- Cabecera `Idempotency-Key` obligatoria en pagos.
- Anulación de pagos con motivo, usuario y recálculo transaccional. Nunca `DELETE`.

---

## 16. API

Estilo: REST versionado `/v1/…`. JSON. Errores estables `{ code, message }`.

Prefijos conceptuales:

```
/v1/auth
/v1/users
/v1/roles
/v1/customers
/v1/loans
/v1/installments
/v1/payments
/v1/routes
/v1/collectors
/v1/evidence
/v1/reports
/v1/audit
/v1/settings
```

Mutaciones financieras: `POST /v1/payments` con cuerpo mínimo (préstamo, valor recibido, método, evidencias, clave de idempotencia). El servidor decide asignación a cuotas.

Paginación: `cursor` o `page/limit` con tope duro (p. ej. 50). Filtros en query. Nunca listados sin límite.

Contratos en [`api.md`](api.md).

---

## 17. PWA

Objetivo: cobrar en la calle, no administrar la empresa.

Capacidades fase de campo:

- Login
- Ruta del día
- Lista de asignados con estado de color
- Registrar pago / abono (valor recibido)
- Firma táctil
- Foto de evidencia
- GPS puntual
- Alta de prospecto
- Confirmación solo tras respuesta del servidor

Fuera de alcance inicial: seguimiento GPS continuo, modo offline completo, cálculo de mora en el dispositivo.

Detalle: [`pwa.md`](pwa.md).

---

## 18. GPS

- Permiso del dispositivo, explícito, en el momento del cobro o del alta.
- Se guarda: latitud, longitud, precisión, timestamp.
- Un punto por operación. No hay tracking del cobrador.
- La comparación “cobro vs domicilio del cliente” queda **preparada** (distancia configurable) y **apagada** hasta que el comprador apruebe la regla y el umbral.

---

## 19. Firma

- Canvas táctil en la PWA.
- Se exporta a PNG o SVG compacto, se comprime, se sube a Storage.
- Se relaciona al **pago** (o al alta, si aplica), no al cliente como foto de perfil.
- Consultable después con el mismo control de acceso que el pago.

---

## 20. Fotografías

Dos usos distintos, no mezclar:

| Tipo | Cuándo | Dónde vive |
| --- | --- | --- |
| Foto de expediente | Alta / actualización del cliente | `customers/…/profile` |
| Evidencia de cobro | En el movimiento | `payments/…/evidence` |

La foto de perfil **no** se pide en cada cobro.

Redimensionar (p. ej. lado largo 1280 px) y comprimir en el dispositivo. El servidor rechaza archivos demasiado grandes o de tipo no permitido.

---

## 21. Auditoría

Tabla append-only `audit_events`:

- actor (user id)
- acción (`payment.registered`, `customer.approved`, …)
- entidad (tipo + id)
- payload relevante (monto, motivo de anulación) — sin secretos
- IP / user-agent cuando exista
- resultado (ok / denied / error)
- timestamp

No se edita ni se borra. Las consultas de auditoría son un módulo con permiso propio.

Detalle: [`audit.md`](audit.md).

---

## 22. Escalabilidad

Diseño para miles de clientes / préstamos / cuotas / pagos, no para millones el día uno, pero sin pintarse contra la pared.

- Paginación y filtros en SQL.
- Índices de búsqueda (documento, teléfono, fechas, estados, cobrador, ruta).
- Agregados de cartera: vistas materializadas o tablas de resumen **cuando** el volumen lo pida. No adelantar.
- Storage separado del Postgres.
- API stateless: se escala horizontalmente detrás de un load balancer.
- Connection pooling (Supabase pooler).
- Preparado para `organization_id` (multiempresa) **sin implementarlo ahora**. Pregunta al comprador.

---

## 23. Rendimiento

- No hidratar el admin con el padrón completo.
- Ficha del cliente: resumen primero; historial y evidencias bajo demanda.
- Miniaturas para fotos de lista; original solo en ficha.
- Evitar N+1: listados con joins explícitos o queries agregadas.
- Caché corta solo en lecturas (dashboard). Nunca cachear saldos como verdad sin invalidar al pagar.
- Compresión HTTP. Imágenes ya comprimidas en origen.

---

## 24. Sincronización

Flujo normal: PWA → API → Postgres → respuesta → PWA.

Si se pierde la red **durante** un cobro: la PWA informa el fallo y **no** marca “registrado”. Reintento con la misma `Idempotency-Key`.

Offline formal (cola local, sync posterior) queda **diseñado como extensión**, no como fase 1. Requiere reglas extra de conflicto que el comprador debe aprobar.

---

## 25. Idempotencia

Obligatoria en pagos y otras mutaciones críticas.

- El cliente genera un UUID de operación **antes** de enviar.
- Se envía en `Idempotency-Key`.
- El servidor guarda clave + hash del cuerpo + respuesta.
- Mismo key + mismo cuerpo → misma respuesta.
- Mismo key + cuerpo distinto → error, no segundo pago.

Esto cubre el doble tap en “Confirmar pago”.

---

## 26. Estrategia de pruebas

Pirámide:

1. **Motor financiero** — unitarias densas (pago exacto, parcial, anulación). Casos de sobrepago **pendientes de regla**.
2. **API** — integración con Postgres de test (crear cliente, duplicados, permisos, idempotencia).
3. **Contratos** — esquemas Zod compartidos.
4. **PWA / admin** — pruebas de flujo críticas (login, registrar cobro mockeando API).
5. **Seguridad** — acceso horizontal, anulación sin permiso.

No se considera “listo” un módulo de dinero sin pruebas del motor.

Detalle: [`testing.md`](testing.md).

---

## 27. Estrategia de despliegue

Entornos: `local` · `staging` · `production`.

Propuesta:

- Admin: Vercel o contenedor.
- PWA: mismo CDN, dominio distinto (`pwa.`).
- API: contenedor (Fly, Railway, o VM).
- Supabase: proyecto separado staging / production.

Migraciones: CI aplica SQL. Prohibido cambiar producción a mano.

Backups: PITR de Supabase + ensayo de restore documentado.

Detalle: [`deployment.md`](deployment.md).

---

## 28. Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Inventar fórmulas de interés/mora | Cartera incorrecta | Documento de reglas + aprobación. Motor con flags “regla no definida” |
| Doble cobro | Dinero duplicado | Idempotencia + bloqueo de fila |
| Cobrador ve clientes ajenos | Fuga de datos | Autorización por ruta + RLS |
| Archivos públicos | Filtración de firmas/fotos | Buckets privados + URLs firmadas |
| Flotantes en JS | Descuadre | NUMERIC en DB; enteros menores o decimal en motor |
| Offline improvisado | Pagos fantasma | No afirmar éxito sin ACK |
| Scope infinito en fase 1 | Producto que no sale | Fases; este documento es el freno |
| Un solo tenant mal asumido | Rehacer esquema | Preguntar multinégocio ahora |

---

## 29. Decisiones pendientes (no improvisar)

1. Moneda, decimales y redondeo.
2. Qué hacer con un pago **mayor** a la cuota (saldo a favor, adelantar cuotas, rechazar).
3. Fórmulas de interés, mora, días de gracia, refinanciación, cancelación anticipada.
4. ¿Multiempresa / varias carteras jurídicas?
5. ¿El cobrador puede ver el historial completo del cliente o solo la cuota del día?
6. ¿Firma obligatoria en todo cobro o configurable?
7. ¿Foto de evidencia obligatoria?
8. Distancia GPS máxima para “cobro en domicilio” (y si se usa).
9. Numeración de préstamos y comprobantes (formato, serie, sucursal).
10. Canal de comprobante (solo en sistema, PDF, WhatsApp, correo).
11. Proveedor de SMS/email.
12. Horario laboral y zona horaria oficial (Colombia, `America/Bogota` propuesto).

---

## 30. Preguntas que debe responder el comprador

Ver también la lista corta en el canvas de revisión.

1. ¿La moneda es COP? ¿Se usan centavos o pesos enteros?
2. Si reciben $15.000 sobre una cuota de $10.000, ¿qué debe hacer el sistema?
3. ¿Interés simple, compuesto, sobre saldo, o cuota fija pactada sin desglose?
4. ¿Hay mora? ¿Desde qué día? ¿Tope?
5. ¿Se permite refinanciar / renovar / cancelar anticipado? ¿Con qué penalidad?
6. ¿Operan una sola empresa o varias?
7. ¿Cuántos cobradores y clientes estiman a 12 meses?
8. ¿El prospecto del cobrador puede convertirse en préstamo el mismo día, o siempre hay revisión?
9. ¿Qué documentos piden al cliente (cédula, pagaré, referencias)?
10. ¿Comprobante legal / DIAN o solo interno?
11. ¿Necesitan trabajo sin internet en campo desde el día uno?
12. ¿Quién puede anular un pago? ¿Con doble aprobación?

---

## Estructura de carpetas propuesta

Aún no se crea el código de aplicación. Esta es la forma objetivo del monorepo:

```
/
  apps/
    admin/                 Next.js — sistema principal
    pwa/                   Vite PWA — cobradores
  packages/
    api/                   Fastify — núcleo
    financial-engine/      Única capa de cálculo
    shared/                Tipos, Zod, permisos
  supabase/
    migrations/            SQL versionado
    seed/
  docs/                    Esta documentación
  prototypes/              Prototipos visuales de aprobación
  tests/
```

---

## Plan de desarrollo por fases

No se avanza de fase en automático. Cada fase: analizar → diseñar → implementar → probar → documentar → **esperar aprobación**.

| Fase | Qué | Entrega |
| --- | --- | --- |
| 1 | Arquitectura | Este documento + prototipo de navegación |
| 2 | ER definitivo | `database.md` aprobado |
| 3–4 | Postgres / migraciones | SQL versionado, sin pantallas |
| 5–7 | API + auth + usuarios/roles | Login real, permisos en servidor |
| 8 | Clientes | Alta, búsqueda, ficha, duplicados |
| 9–11 | Préstamos, motor (reglas aprobadas), cuotas | Estado de cuenta de lectura |
| 12–13 | Pagos/abonos + cartera | Idempotencia, anulación |
| 14–15 | Rutas y cobradores | Asignación |
| 16–17 | PWA + firma/foto/GPS | Flujo de cobro real |
| 18–19 | Reportes y auditoría | Consultas |
| 20–22 | Seguridad, pruebas, optimización | Checklist de producción |
| 23 | Despliegue | Staging y luego producción |

**Fase actual: 1.** Siguiente paso tras aprobación: cerrar modelo ER y las preguntas financieras mínimas (moneda y sobrepago) antes de migraciones.

---

## Qué se entregó en esta ejecución

1. Arquitectura propuesta (este archivo).
2. Tecnologías recomendadas (§2–3).
3. Estructura de carpetas (§ anterior).
4. Diagrama de módulos (§5) y de flujo (§4).
5. ER inicial (§6–8) y lista de tablas en [`database.md`](database.md).
6. Estrategias de Supabase, Storage, auth, roles, seguridad, PWA, GPS, evidencias, auditoría, escalabilidad.
7. Preguntas al comprador (§30).
8. Plan por fases.
9. Enfoque de UI y prototipo navegable.

No se crearon tablas, ni la PWA real, ni formularios de producción.
