# Sistema madre — contrato del producto

**Estado:** ley del proyecto. Si algo choca con esto, gana este documento.  
**Directriz 2026-09-25:** ver también `.cursor/rules/nube-operativa.mdc`.

El **panel del sistema** (admin en https://prestamo-y-cobranza.vercel.app) es el **padre de producto** (estructura, commits, proyecciones).  
Cobrador, supervisor, login y proyecciones (planilla, banco, CIE, nombres) son **hijos**: leen y proyectan; no inventan otra verdad.

**Datos operativos:** la fuente única de verdad es **Supabase**.  
**Código:** GitHub. **Ejecución:** Vercel.  
**Este PC:** taller (desarrollar / commit / push). El negocio **no** depende de que esté encendido.

---

## 1. Qué significa “padre”

| Hace el padre (cualquier mutación) | Debe pasar al instante |
| --- | --- |
| Crear / editar / borrar / activar | Commit + local (caché) + **await flush nube** + proyección |
| Cambiar un dato canónico | Todas las pantallas / aparatos que lo muestran |
| Dar acceso (usuario/clave/rol) | Login y app del rol sin esperar “mañana” |

El cobro en la app del cobrador ya sigue esta ley (`commitCollectorPayment` → `PG-` → proyecciones → flush).  
El resto del sistema debe ser **igual de fuerte**.

---

## 2. Cadena única (sin atajos)

```
Mutación (admin, cobrador o supervisor)
  → commit atómico (módulo dueño)
    → persistir caché local + encolar
    → await flush a Supabase
    → proyectar hijos (nombres, planilla, banco, …)
    → otro dispositivo ve lo nuevo (pull / Realtime)
```

Modelos de referencia:

- Dinero: `docs/operational-money.md` + `commitCollectorPayment`
- Personas: `docs/people-catalog.md` + `commit-people-catalog`
- Cartera: `commit-portfolio-catalog`
- Cierre jornada: `.cursor/rules/day-close-sync.mdc`

---

## 3. Instantáneo (garantía del negocio)

**La garantía del negocio es la nube operativa (Supabase), no este PC.**

1. Tras Guardar / cobrar / cerrar: el aparato escribe local (rápido) **y** espera flush a Supabase.
2. Si falla la red: queda en cola local y se reintenta; el criterio de “otros lo ven” es cuando la nube lo tiene.
3. Pull / Realtime: traen lo fresco de la nube. Un edit local **en vuelo** (cola pendiente) no se rebobina; lo ya confirmado en nube gana frente a caché vieja de otro aparato.
4. Apagar el PC del dueño **no** detiene cobros ni cierres en celulares.

---

## 4. Limpio y vendible

- Una fuente de verdad por dominio (Supabase para operativo).
- Estructura dura: módulos dueños, invariantes, gates (`verify:prod`).
- **Cero parches** de UI que oculten fallos (ver `.cursor/rules/no-patch-cycle.mdc`).
- Explicable al cliente: “el sistema en la nube manda; el celular proyecta y encola”.

---

## 5. Prohibido

- Segundo “sistema” paralelo (login con lista fija, seed que revive muertos).
- `setState` sin commit + cola + flush.
- Depender del PC del dueño para que el supervisor vea un cobro.
- Decir “ya está” sin build SHA + flush nube verificado cuando el cambio es de datos/sync.

---

## 6. Deploy (código)

Igual que siempre: `main` → proyecto `prestamo-y-cobranza` → `npm run verify:prod` → solo la URL canónica.  
Push de código ≠ sincronizar datos.
