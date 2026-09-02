# PWA de cobradores

La PWA es una interfaz de campo sobre la **misma API**. No es un sistema paralelo y no tiene base de datos financiera propia.

---

## Qué hace

- Iniciar sesión.
- Ver la ruta del día y el conteo: cobrados / abonos / pendientes.
- Abrir un cliente asignado.
- Registrar el valor recibido.
- Capturar firma, foto de evidencia y un punto GPS.
- Registrar un prospecto (queda pendiente de revisión).
- Ver confirmación **solo** si el servidor aceptó.

---

## Qué no hace

- Calcular saldo, mora o interés.
- Mostrar la cartera completa.
- Anular pagos.
- Administrar usuarios, roles o configuración.
- Seguir al cobrador en segundo plano.
- Afirmar “pago registrado” sin respuesta válida.
- Modo offline completo (fase posterior).

---

## Interfaz

Prioridad: una mano, botones grandes, poco texto, estados de color.

```
RUTA DEL DÍA          20 clientes
  al día 8 · abono 3 · pendiente 7

  ● Carlos Pérez      cuota 10.000    PENDIENTE
  ● María Gómez       cuota 10.000    PENDIENTE
  ● Pedro Rodríguez   cuota 10.000    PAGADA
  ● Ana López         cuota 10.000    ABONO
```

No se replica el layout del admin (top bar + sidebar izquierdo). El teléfono no es el ERP.

---

## Conexión

- Online-first.
- Si falla la red al confirmar: mensaje claro + reintento con la misma clave de idempotencia.
- Cola offline: no en fase 1.

---

## Permisos del dispositivo

- Cámara: evidencia / foto de expediente en el alta.
- Ubicación: un disparo por operación, con explicación visible.
- Almacenamiento: solo lo necesario para comprimir antes de subir.

---

## Stack propuesto

`apps/pwa`: Vite + React + TypeScript. PWA (manifest, service worker para assets estáticos, no para sync financiera todavía).

Comparte tipos y esquemas Zod con `packages/shared`.
