import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteRow } from "@/lib/mock-data";

/**
 * Modelo de sincronización demo:
 * - Celular del cobrador → almacén central (localStorage) → panel administración
 * - Entre celulares de cobradores NO hay contacto ni intercambio de datos
 * - Cada cobrador solo ve sus rutas/cobros asignados
 */

export function assignmentsForMobileCollector(
  collectorRef: string,
  assignments: DailyCollectionAssignment[],
) {
  return assignments.filter((row) => row.collectorRef === collectorRef);
}

export function routesForMobileCollector(collectorRef: string, routes: RouteRow[]) {
  return routes.filter((row) => row.collectorRef === collectorRef);
}

export function assertOwnCollectorPayment(
  sessionCollectorRef: string | undefined,
  draftCollectorRef: string,
) {
  if (!sessionCollectorRef) {
    return "Tu usuario no está vinculado a un cobrador.";
  }
  if (sessionCollectorRef !== draftCollectorRef) {
    return "Solo puedes registrar cobros de tu propia ruta.";
  }
  return null;
}
