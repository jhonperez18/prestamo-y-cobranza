# Sistema madre — contrato del producto

**Estado:** ley del proyecto. Si algo choca con esto, gana este documento.

El **panel del sistema** (admin en https://prestamo-y-cobranza.vercel.app) es el **padre de todo**.  
Cobrador, supervisor, login y proyecciones (planilla, banco, CIE, nombres) son **hijos**: leen y proyectan; no inventan otra verdad.

---

## 1. Qué significa “padre”

| Hace el padre | Debe pasar al instante |
| --- | --- |
| Crear / editar / borrar / activar | Persistencia local + cola nube + proyección |
| Cambiar un dato canónico | Todas las pantallas que lo muestran |
| Dar acceso (usuario/clave/rol) | Login y app del rol sin esperar “mañana” |

No es solo “usuarios”: es **cualquier mutación** del sistema (personas, clientes, préstamos, rutas, cobros de caja, etc.).

El cobro en la app del cobrador ya sigue esta ley (`commitCollectorPayment` → `PG-` → proyecciones).  
El padre debe ser **igual o más fuerte**.

---

## 2. Cadena única (sin atajos)

```
Mutación en el sistema
  → commit atómico (módulo dueño)
  → persistir raíz (localStorage + cola)
  → proyectar hijos (nombres, planilla, banco, …)
  → await flush a la nube
  → lectura / login / otro dispositivo ve lo nuevo
```

Modelos de referencia:

- Dinero: `docs/operational-money.md` + `commitCollectorPayment`
- Personas: `docs/people-catalog.md` + `commit-people-catalog`
- Cartera (cliente / préstamo → planilla): `commit-portfolio-catalog`

Toda área nueva del producto **debe** nacer con el mismo patrón: un commit, una raíz, proyecciones, flush esperado.

---

## 3. Instantáneo (garantía de este PC)

**La garantía primaria es el sistema central en este aparato**, no la nube ni el deploy.

1. Tras Guardar: el PC **ya** tiene el dato (síncrono en `localStorage` + respaldo `-bak`).
2. Nube / commit / push: para que **otros** vean lo mismo — se actualiza después; no sustituye la garantía local.
3. Flush a nube cuando el flujo lo pide; si falla la red, **en este PC el dato sigue**.
4. Login y lecturas: **local primero**; pull solo para completar, **nunca** para borrar altas/edits locales frescos.
5. Cero pantallas con datos viejos por Auth, SQL espejo o seed mock.

---

## 4. Limpio y vendible

- Una fuente de verdad por dominio (no dos listas, no tres “cobrado hoy”).
- Estructura dura: módulos dueños, invariantes, gates (`verify:prod`).
- **Cero parches** de UI que oculten fallos (ver `.cursor/rules/no-patch-cycle.mdc`).
- Código que se pueda explicar a un cliente: “el sistema manda; el celular proyecta”.

---

## 5. Prohibido

- Segundo “sistema” paralelo (login con lista fija, seed que revive muertos, SQL que pisa Storage).
- `setState` sin commit + cola.
- Pull que rebobina lo que el padre acaba de guardar.
- Decir “ya está” sin build SHA + verificación de raíz (catálogo / pagos según el cambio).

---

## 6. Deploy

Igual que siempre: `main` → proyecto `prestamo-y-cobranza` → `npm run verify:prod` → solo la URL canónica.
