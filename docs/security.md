# Seguridad

El sistema trata datos personales y financieros. La API no confía en el frontend ni en la PWA.

---

## Controles de la fase de implementación

| Control | Cómo |
| --- | --- |
| Transporte | HTTPS obligatorio en staging y production |
| Secretos | Env / vault. Nunca en el repo ni en el bundle |
| Contraseñas | Hash a cargo de Supabase Auth (bcrypt/argon). Política de complejidad |
| Sesión | Token de corta vida + refresh. Revocación al desactivar usuario |
| Autorización | Permisos en servidor + RLS |
| Acceso horizontal | Toda lectura/escritura filtra por visibilidad (ruta, rol) |
| Inyección SQL | Query builder parametrizado |
| Validación | Zod en el borde. Tipos, rangos, MIME, tamaño |
| CORS | Orígenes explícitos del admin y la PWA |
| Rate limit | Login, reset, `POST /payments` |
| Archivos | Bucket privado, allowlist, techo de MB, URL firmada corta |
| Pagos | Idempotencia + transacción + no DELETE |
| Logs | Accesos sensibles y denegaciones |

---

## Datos personales

- Foto, firma, documento, teléfono, dirección y GPS son datos sensibles.
- Acceso mínimo: el cobrador no descarga el padrón.
- Evidencias solo con permiso y vínculo a la operación.
- No se usan URLs públicas permanentes.

Cumplimiento legal (Habeas Data / políticas internas del comprador): **pregunta pendiente**. El diseño técnico no sustituye el aviso de privacidad ni el consentimiento de geolocalización.

---

## Amenazas a vigilar

1. Doble envío de cobro (red inestable).
2. Cobrador que itera UUIDs de clientes.
3. Admin XSS robando sesión (CSP, sanitizar notas).
4. Subida de archivo malicioso como “evidencia”.
5. Service role key filtrada en el cliente.
6. Cambio de monto en el body a un valor no cobrado — el servidor no “cree” el desglose del cliente; solo el `amount_received` y las reglas.

---

## Lo que no se hace en fase 1

- MFA (queda previsto).
- WAF dedicado (el hosting puede aportarlo).
- Cifrado de columna además del disco (evaluar si el comprador lo exige).
- Tracking GPS continuo.
