# Posición en ruta — contrato

**Estado:** vigente.  
**Código:** `apps/admin/lib/client-route-order.ts`, `commit-portfolio-catalog.ts`.

## Fuente de verdad

`ClientRow.route` + `ClientRow.routeOrder` definidos en **Clientes → Modificar**.

Todas las vistas (Listado, planilla de ruta, app cobrador/supervisor, panel) leen ese orden.

## Reglas

1. Ubicar en `#N` → permanece en `#N` hasta que el dueño la cambie.
2. Insertar en medio → corre el contador del resto (1…N).
3. Alta sin posición → final de ruta.
4. Editar ficha sin cambiar `#` → no reordena vecinos.
5. Persistencia: local primero; mirror nube; pull no rebobina.

## API

- `placeClientOnRoute` — mover / insertar
- `clientsOnRouteSorted` / `compareClientsByRoutePosition` — listar
- `nextRouteOrder` — append
- `normalizeAllRouteOrders` — solo si hay huecos o duplicados
