/**
 * Planilla y rutas del día en IndexedDB. Crecen ~190 KB por día y no caben en el cupo de
 * localStorage (~5 MB): al llenarlo, el aparato dejaba de guardar cobros, préstamos y planilla
 * recién bajados de la nube (caso supervisor 03/10).
 *
 * Lectura sincrónica desde memoria; la memoria se carga de IndexedDB al arrancar
 * (`hydrateBigDemoStore` en `AuthGate`, antes de pintar). Escritura: memoria al instante,
 * IndexedDB detrás. Sin IndexedDB (modo privado viejo) todo sigue en localStorage.
 */
const DB_NAME = "nexo-demo-big";
const STORE = "keys";
const CHANNEL = "nexo-demo-big";

export const BIG_DEMO_KEYS: readonly string[] = [
  "nexo-demo-daily-assignments",
  "nexo-demo-routes",
];

/** Otra pestaña guardó una clave grande: rehidratar como con el evento `storage`. */
export const BIG_DEMO_STORE_CHANGED_EVENT = "nexo-big-demo-store-changed";

const memory = new Map<string, string>();
const pending = new Map<string, string>();
const failures = new Set<string>();
let active = false;
let writing: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;

export function isBigDemoKey(key: string) {
  return BIG_DEMO_KEYS.includes(key);
}

/** true = las claves grandes viven en IndexedDB (memoria cargada). */
export function bigDemoStoreActive() {
  return active;
}

export function readBigDemoRaw(key: string): string | null {
  return memory.get(key) ?? null;
}

export function writeBigDemoRaw(key: string, raw: string) {
  memory.set(key, raw);
  pending.set(key, raw);
  if (!writing) writing = drainPending();
}

export function removeBigDemoKey(key: string) {
  memory.delete(key);
  pending.delete(key);
  void withStore("readwrite", (store) => store.delete(key)).catch((error: unknown) => {
    console.error("big-demo-store", key, error);
  });
}

/** Claves cuyo último guardado en IndexedDB falló (se reintenta con el próximo cambio). */
export function bigDemoStoreFailures(): string[] {
  return [...failures];
}

/** Espera a que lo escrito en memoria quede en IndexedDB. */
export async function flushBigDemoStore(): Promise<void> {
  while (writing) await writing;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("big-demo-store-open"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("big-demo-store-tx"));
      tx.onabort = () => reject(tx.error ?? new Error("big-demo-store-abort"));
    });
  } finally {
    db.close();
  }
}

async function drainPending(): Promise<void> {
  try {
    while (pending.size > 0) {
      const [key, raw] = pending.entries().next().value as [string, string];
      pending.delete(key);
      try {
        await withStore("readwrite", (store) => store.put(raw, key));
        failures.delete(key);
        channel?.postMessage({ key });
      } catch (error) {
        console.error("big-demo-store", key, error);
        failures.add(key);
      }
    }
  } finally {
    writing = null;
  }
}

async function readAllFromIdb(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const key of BIG_DEMO_KEYS) {
    const value = await withStore<unknown>("readonly", (store) => store.get(key));
    if (typeof value === "string") found.set(key, value);
  }
  return found;
}

/**
 * Copia de localStorage a IndexedDB. Con el almacén activo nadie escribe ahí: si hay algo,
 * lo dejó un arranque sin almacén (recuperación, paquete, build anterior) y es lo más nuevo.
 */
async function copyFromLocalStorage(found: Map<string, string>) {
  for (const key of BIG_DEMO_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw === null || found.get(key) === raw) continue;
    await withStore("readwrite", (store) => store.put(raw, key));
    found.set(key, raw);
  }
}

/** Solo con todo confirmado en IndexedDB se suelta del cupo de localStorage. */
function releaseLocalStorage() {
  for (const key of BIG_DEMO_KEYS) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${key}-bak`);
  }
}

function listenOtherTabs() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<{ key?: string }>) => {
    const key = event.data?.key;
    if (!key || !isBigDemoKey(key) || pending.has(key)) return;
    void withStore<unknown>("readonly", (store) => store.get(key))
      .then((value) => {
        if (typeof value !== "string" || pending.has(key)) return;
        memory.set(key, value);
        window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT, { detail: { key } }));
      })
      .catch((error: unknown) => {
        console.error("big-demo-store", key, error);
      });
  };
}

/** Arranque: carga la memoria desde IndexedDB y muda lo que quedaba en localStorage. */
export async function hydrateBigDemoStore(): Promise<void> {
  if (active || typeof window === "undefined" || typeof indexedDB === "undefined") return;
  try {
    const found = await readAllFromIdb();
    await copyFromLocalStorage(found);
    for (const [key, raw] of found) memory.set(key, raw);
    active = true;
    releaseLocalStorage();
    listenOtherTabs();
  } catch (error) {
    console.error("big-demo-store", "IndexedDB no disponible: planilla sigue en localStorage", error);
  }
}
