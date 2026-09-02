# Storage

Los binarios no viven en PostgreSQL. Postgres guarda la referencia.

---

## Buckets

Un bucket privado `evidence` (nombre final al implementar). Políticas: ningún objeto público.

Rutas (IDs, nunca el nombre del cliente):

```
customers/{customer_id}/profile/{file_id}
customers/{customer_id}/documents/{file_id}
loans/{loan_id}/documents/{file_id}
payments/{payment_id}/evidence/{file_id}
payments/{payment_id}/signatures/{file_id}
```

---

## Tabla `files`

Campos mínimos: id, bucket, path, mime, byte_size, checksum, owner_user_id, related_type, related_id, created_at.

Flujo:

1. API autoriza y emite URL de subida firmada.
2. Cliente sube (foto ya redimensionada).
3. Cliente confirma. API verifica tamaño/tipo y asocia a la entidad.

Lectura: URL firmada de pocos minutos, tras comprobar permiso.

---

## Límites propuestos (ajustables)

| Tipo | MIME | Techo |
| --- | --- | --- |
| Foto | image/jpeg, image/webp | 2 MB ya comprimida |
| Firma | image/png, image/webp | 300 KB |
| Documento | application/pdf | 8 MB |

El servidor rechaza lo demás. La PWA comprime antes: lado largo ≈ 1280 px, calidad media.

---

## Foto de cliente vs evidencia

La foto de expediente se carga en el alta o en una actualización explícita del admin.  
La evidencia de cobro es del **pago**. No se reutiliza la cara del cliente como “prueba” de cada visita.
