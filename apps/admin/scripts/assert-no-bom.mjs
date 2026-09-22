/**
 * BOM en globals.css invalida `:root` → fondo/colores/login rotos.
 * Falla duro si el archivo empieza con UTF-8 BOM.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css");
const buf = readFileSync(cssPath);
const bom = Buffer.from([0xef, 0xbb, 0xbf]);

if (buf.subarray(0, 3).equals(bom)) {
  console.error(
    "FALLO: apps/admin/app/globals.css tiene UTF-8 BOM. Quitar BOM — rompe :root (colores/fondo/login).",
  );
  process.exit(1);
}

const head = buf.subarray(0, 32).toString("utf8");
if (!/^\s*:root\s*\{/.test(head)) {
  console.error(
    "FALLO: apps/admin/app/globals.css no empieza con :root { — tema del sistema no aplica.",
  );
  process.exit(1);
}

console.log("OK: globals.css sin BOM, :root intacto.");
