# Auditoría

Debe poder responderse: quién, qué, cuándo, sobre qué entidad, con qué resultado.

---

## Qué se registra (mínimo)

| Evento | Ejemplo |
| --- | --- |
| Auth | login ok / login fallido / logout |
| Cliente | alta, edición, aprobación, rechazo |
| Préstamo | creación (con snapshot de términos) |
| Pago | registro, intento duplicado, anulación |
| Ruta | creación, asignación de paradas |
| Usuario | alta, cambio de rol, desactivación |
| Archivo | subida asociada a entidad |
| Config | cambio de setting (valor previo / nuevo) |
| Permiso denegado | intento de anular sin permiso |

---

## Tabla `audit_events`

Append-only. Sin UPDATE/DELETE de aplicación.

- `actor_user_id` (nullable si el login falló)
- `action` (string estable: `payment.registered`)
- `entity_type`, `entity_id`
- `payload` JSONB (monto, motivo; **sin** tokens ni fotos)
- `result` (`ok` · `denied` · `error`)
- `ip`, `user_agent`
- `created_at`

---

## Consulta

Módulo Sistema → Auditoría. Permiso `auditoria.ver`.

Filtros: fecha, usuario, acción, entidad.

Las fotos y firmas no se incrustan en el log; se enlaza el `file_id` si hace falta.
