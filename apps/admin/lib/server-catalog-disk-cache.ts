/**
 * Caché en disco de clientes / préstamos.
 * Si Supabase se cuelga, la hoja del cobrador igual pinta (como users-catalog).
 */
import { promises as fs } from "fs";
import path from "path";

type CacheFile<T> = { at: string; rows: T[] };

const DIR = path.join(process.cwd(), "data");

async function readCache<T>(file: string): Promise<T[] | null> {
  try {
    const raw = await fs.readFile(path.join(DIR, file), "utf8");
    const parsed = JSON.parse(raw) as CacheFile<T>;
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

async function writeCache<T>(file: string, rows: T[]): Promise<void> {
  if (!rows.length) return;
  try {
    await fs.mkdir(DIR, { recursive: true });
    const payload: CacheFile<T> = { at: new Date().toISOString(), rows };
    await fs.writeFile(path.join(DIR, file), `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("catalog-disk-cache-write", file, error);
  }
}

export async function readClientsDiskCache<T>(): Promise<T[] | null> {
  return readCache<T>("clients-catalog-cache.json");
}

export async function writeClientsDiskCache<T>(rows: T[]): Promise<void> {
  return writeCache("clients-catalog-cache.json", rows);
}

export async function readLoansDiskCache<T>(): Promise<T[] | null> {
  return readCache<T>("loans-catalog-cache.json");
}

export async function writeLoansDiskCache<T>(rows: T[]): Promise<void> {
  return writeCache("loans-catalog-cache.json", rows);
}

export async function withHardTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
