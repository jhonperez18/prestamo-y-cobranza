/**
 * Señal de limpieza de camino en aparatos (SW / Cache Storage / -bak).
 * No toca cobros, clientes, usuarios, préstamos ni colas.
 */
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "client-clean-epoch.json");

export type ClientCleanEpoch = {
  epoch: string;
};

export async function readClientCleanEpoch(): Promise<string> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as { epoch?: string };
    const epoch = String(parsed?.epoch || "").trim();
    return epoch && Number.isFinite(Date.parse(epoch)) ? epoch : "";
  } catch {
    return "";
  }
}

export async function bumpClientCleanEpoch(now = new Date()): Promise<string> {
  const epoch = now.toISOString();
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, `${JSON.stringify({ epoch }, null, 2)}\n`, "utf8");
  return epoch;
}
