/**
 * Alias explícito de la proyección de dinero operativo.
 * Preferir este nombre en código nuevo: deja claro que PG- es la raíz.
 *
 * @see docs/operational-money.md
 * @see synchronizeOperationalState
 */
export {
  synchronizeOperationalState as projectOperationalMoney,
  type OperationalSyncInput as OperationalMoneyInput,
  type OperationalSyncResult as OperationalMoneyProjection,
} from "@/lib/operational-sync";
