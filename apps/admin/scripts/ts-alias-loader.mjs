/**
 * Loader mínimo para correr módulos `lib/*.ts` desde Node (pruebas de invariantes).
 * Resuelve `@/…` → raíz de apps/admin y transpila TS con el `typescript` del proyecto.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveFile(base) {
  if (existsSync(base) && !base.endsWith("/") && path.extname(base)) return base;
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = resolveFile(path.join(ROOT, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parent = path.dirname(fileURLToPath(context.parentURL));
    const file = resolveFile(path.resolve(parent, specifier));
    if (file && /\.tsx?$/.test(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.tsx?$/.test(url)) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
