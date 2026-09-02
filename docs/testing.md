# Pruebas

Ningún módulo de dinero se considera listo sin pruebas automatizadas del motor y de la API.

---

## Prioridad

1. Motor financiero (unitarias).
2. API + Postgres de test (integración).
3. Permisos y acceso horizontal.
4. Idempotencia.
5. Duplicados de cliente.
6. Flujos PWA/admin con API mock (e2e selectivos).

---

## Casos obligatorios cuando existan las reglas

| Caso | Criterio |
| --- | --- |
| Crear cliente | Persistencia y estado |
| Duplicado documento/teléfono | 409 + candidatos |
| Crear préstamo | `loan_terms` congelados |
| Generar cuotas | Según términos **aprobados** |
| Pago exacto | Cuota `paid` |
| Abono | Cuota `partial`, pendiente correcto |
| Pago superior | Según regla aprobada; hoy debe fallar cerrado |
| Anulación | Estado `voided`, cuotas revertidas, traza |
| Permiso cobrador | No ve clientes de otra ruta |
| Doble tap | Un solo pago |
| GPS / firma / foto | Referencias guardadas, no binarios en SQL |
| Auditoría | Evento escrito |

Mora, interés y refinanciación: se añaden tests **junto** con la fórmula aprobada, no antes con números inventados.

---

## Entorno

- Postgres de test (contenedor) por CI.
- Sin pegarle a staging real para unitarias.
- Datos de dinero en strings/`NUMERIC`, nunca floats en aserciones.
