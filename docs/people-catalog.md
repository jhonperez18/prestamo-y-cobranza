# Catálogo de personas — contrato vivo (Listado = raíz)

**Estado:** vigente en `apps/admin`.  
**Paralelo:** misma lógica que cobros `PG-` (`docs/operational-money.md`).

---

## 1. Fuente de verdad

| Capa | Qué es | Quién manda |
| --- | --- | --- |
| **Usuarios** `UserRow` (`USR-`) | Acceso, rol, clave, permisos | **Raíz** = Usuario → Listado |
| **Cobradores** `CollectorRow` (`COB-`) | Identidad de campo | Proyección del usuario cobrador |
| **Login** | Entrada al sistema | Lee el mismo catálogo (no lista aparte) |
| **Rutas / pagos (nombre)** | Texto denormalizado | Se proyecta al renombrar |

Nube: Storage `app-catalog/users.json` es la raíz remota del catálogo; SQL `app_users` es espejo.

---

## 2. Commit único

Toda mutación de personas pasa por:

```ts
commitCreateUser / commitUpdateUser / commitDeleteUser /
commitToggleUserActive / commitConvertToCollector / commitUserPermissions
// apps/admin/lib/commit-people-catalog.ts
```

Eso, en una pasada:

1. Persiste catálogo local (`nexo-demo-users`)
2. Encola mirror (usuario + cobrador + rutas tocadas)
3. Proyecta nombre/login/activo a cobrador, rutas y pagos
4. `flushPeopleCatalogToCloud()` sube colas (como el flush de `PG-`)

---

## 3. Obligatorio

1. Crear / modificar / eliminar / activar solo desde el Listado (o perfil admin vía `upsertUserInCatalog`).
2. Tras mutar: commit + flush (no “solo setState”).
3. Login valida **primero** el catálogo; Auth es respaldo.
4. Cambio de nombre/login/clave en Listado = mismo dato en app móvil / supervisor / login.

## 4. Prohibido

- Segunda lista de usuarios en el login.
- Convertir a cobrador sin `upsert` / mirror (queda solo en React).
- Pull SQL viejo que pise Storage / Listado.
- Clave distinta en Auth vs Listado como fuente de verdad del demo.
