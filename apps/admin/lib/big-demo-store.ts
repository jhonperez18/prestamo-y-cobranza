/**
 * Datos operativos en IndexedDB (cientos de MB), no en localStorage (~5 MB por sitio).
 * El 03/10 la planilla, rutas, cobros y préstamos llenaron el cupo del supervisor: el aparato
 * bajaba la nube y no podía guardarla. En localStorage solo quedan sesión, banderas, colas de
 * subida (chicas y de escritura inmediata) y preferencias.
 *
 * `demoStorage` tiene la forma de localStorage: lectura sincrónica desde memoria; la memoria se
 * carga de IndexedDB al arrancar (`hydrateBigDemoStore` en `AuthGate`, antes de pintar).
 * Escritura: memoria al instante, IndexedDB detrás. Las copias `-bak` viajan igual.
 * Sin IndexedDB (modo privado viejo) todo sigue en localStorage, como antes.
 */
const DB_NAME = "nexo-demo-big";
const STORE = "keys";
const CHANNEL = "nexo-demo-big";

/** Claves de datos (y su `-bak`). Las colas `*-queue` siguen en localStorage. */
export const BIG_DEMO_KEYS: readonly string[] = [
  "nexo-demo-users",
  "nexo-demo-clients",
  "nexo-demo-collectors",
  "nexo-demo-routes",
  "nexo-demo-daily-logs",
  "nexo-demo-daily-assignments",
  "nexo-demo-payments",
  "nexo-demo-loans",
  "nexo-demo-banco-accounts",
  "nexo-demo-banco-movements",
  "nexo-demo-banco-reconciliations",
  "nexo-demo-pagos-varios",
  "nexo-demo-collector-month-closes",
  "nexo-demo-collector-day-expenses",
  "nexo-demo-collector-day-closes",
  "nexo-demo-planilla-cash-closes",
];

/** Otra pestaña guardó una clave de datos: rehidratar como con el evento `storage`. */
export const BIG_DEMO_STORE_CHANGED_EVENT = "nexo-big-demo-store-changed";

const memory = new Map<string, string>();
/** `null` = borrar en IndexedDB. */
const pending = new Map<string, string | null>();
const failures = new Set<string>();
let active = false;
let writing: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;

const ALL_KEYS: readonly string[] = BIG_DEMO_KEYS.flatMap((key) => [key, `${key}-bak`]);

/** Clave de datos o su copia `-bak`. */
export function isBigDemoKey(key: string) {
  return ALL_KEYS.includes(key);
}

/** true = los datos viven en IndexedDB (memoria cargada). */
export function bigDemoStoreActive() {
  return active;
}

function routed(key: string) {
  return active && isBigDemoKey(key);
}

/** Único acceso a las claves `nexo-demo-*`: datos → IndexedDB; el resto → localStorage. */
export const demoStorage = {
  getItem(key: string): string | null {
    if (routed(key)) return memory.get(key) ?? null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, raw: string) {
    if (!routed(key)) {
      window.localStorage.setItem(key, raw);
      return;
    }
    memory.set(key, raw);
    queueWrite(key, raw);
  },
  removeItem(key: string) {
    if (!routed(key)) {
      window.localStorage.removeItem(key);
      return;
    }
    if (!memory.has(key)) return;
    memory.delete(key);
    queueWrite(key, null);
  },
};

/** Claves cuyo último guardado en IndexedDB falló (se reintenta con el próximo cambio). */
export function bigDemoStoreFailures(): string[] {
  return [...failures];
}

/** Espera a que lo escrito en memoria quede en IndexedDB. */
export async function flushBigDemoStore(): Promise<void> {
  while (writing) await writing;
}

function queueWrite(key: string, raw: string | null) {
  pending.set(key, raw);
  if (!writing) writing = drainPending();
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
      const [key, raw] = pending.entries().next().value as [string, string | null];
      pending.delete(key);
      try {
        if (raw === null) await withStore("readwrite", (store) => store.delete(key));
        else await withStore("readwrite", (store) => store.put(raw, key));
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

/** Una transacción para varias operaciones (arranque: leer todo, mudar todo). */
async function inOneTransaction(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("big-demo-store-tx"));
      tx.onabort = () => reject(tx.error ?? new Error("big-demo-store-abort"));
    });
  } finally {
    db.close();
  }
}

async function readAllFromIdb(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await inOneTransaction("readonly", (store) => {
    for (const key of ALL_KEYS) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (typeof request.result === "string") found.set(key, request.result);
      };
    }
  });
  return found;
}

/**
 * Copia de localStorage a IndexedDB. Con el almacén activo nadie escribe ahí: si hay algo,
 * lo dejó un arranque sin almacén (recuperación, build anterior) y es lo más nuevo.
 */
async function copyFromLocalStorage(found: Map<string, string>) {
  const moving = new Map<string, string>();
  for (const key of ALL_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw !== null && found.get(key) !== raw) moving.set(key, raw);
  }
  if (!moving.size) return;
  await inOneTransaction("readwrite", (store) => {
    for (const [key, raw] of moving) store.put(raw, key);
  });
  for (const [key, raw] of moving) found.set(key, raw);
}

/** Solo con todo confirmado en IndexedDB se suelta del cupo de localStorage. */
function releaseLocalStorage() {
  for (const key of ALL_KEYS) window.localStorage.removeItem(key);
}

function listenOtherTabs() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<{ key?: string }>) => {
    const key = event.data?.key;
    if (!key || !isBigDemoKey(key) || pending.has(key)) return;
    void withStore<unknown>("readonly", (store) => store.get(key))
      .then((value) => {
        if (pending.has(key)) return;
        if (typeof value === "string") memory.set(key, value);
        else memory.delete(key);
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
    console.error("big-demo-store", "IndexedDB no disponible: los datos siguen en localStorage", error);
  }
}
