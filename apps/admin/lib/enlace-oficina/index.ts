export type { EnlaceEstadoCodigo, EnlaceOficinaSnapshot, EnlaceDetectInput } from "./types";
export { resolveEnlaceEstado, enlaceEstadoLabel } from "./detect";
export {
  ENLACE_OFICINA_CHANGED_EVENT,
  readEnlaceOficinaSnapshot,
  reportEnlaceReach,
  probeEnlaceOficina,
  startEnlaceOficinaWatch,
} from "./reach";
export { useEnlaceOficina } from "./use-enlace-oficina";
