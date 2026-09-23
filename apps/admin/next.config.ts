import type { NextConfig } from "next";
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";

/** Commit corto del build — Vercel/prod: SHA del deploy; arranque local: HEAD. */
function resolveBuildId() {
  const fromVercel = (process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const APP_BUILD = resolveBuildId();

/** Solo el build de Hostinger (cobros.smokecompany.shop). Vercel sigue en servidor. */
const hostingerExport = process.env.HOSTINGER_STATIC_EXPORT === "1";

function adminRoot() {
  const here = process.cwd();
  if (fs.existsSync(path.join(here, "app")) && fs.existsSync(path.join(here, "next.config.ts"))) {
    return here;
  }
  const nested = path.join(here, "apps", "admin");
  if (fs.existsSync(path.join(nested, "next.config.ts"))) return nested;
  return here;
}

/**
 * El manifest de la app es `app/manifest.ts`. El export no incluye archivos `.ts`
 * de ruta (así quedan fuera `/api`). Se copia el manifest estático que ya existe
 * y se borra al terminar, para no dejar un archivo nuevo en el proyecto.
 */
function publishStaticManifest(root: string) {
  if (process.env.JEST_WORKER_ID) return;
  const dest = path.join(root, "public", "manifest.webmanifest");
  if (fs.existsSync(dest)) return;
  const src = path.join(root, "public", "pwa", "manifests", "sistema.webmanifest");
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
  process.once("exit", () => {
    try {
      fs.rmSync(dest, { force: true });
    } catch (error) {
      console.error("hostinger-manifest-cleanup", error);
    }
  });
}

function pidAlive(pid: string) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * `/instalar/[canal]` es dinámica. El export escribe un `dynamicParams` literal
 * solo en memoria de este proceso y al salir repone el archivo original.
 * La copia de respaldo no se borra hasta que el original quedó restaurado.
 */
function syncCanalPageForExport(root: string) {
  if (process.env.JEST_WORKER_ID) return;
  const live = path.join(root, "app", "instalar", "[canal]", "page.tsx");
  const holdDir = path.join(root, ".hostinger-canal-hold");
  const backup = path.join(holdDir, "page.tsx");
  const lock = path.join(holdDir, ".lock");

  const restoreFromBackup = () => {
    if (!fs.existsSync(backup) || !fs.existsSync(live)) return;
    fs.copyFileSync(backup, live);
    const restored = fs.readFileSync(live, "utf8");
    const saved = fs.readFileSync(backup, "utf8");
    if (restored !== saved) return;
    fs.rmSync(holdDir, { recursive: true, force: true });
  };

  if (!hostingerExport) {
    if (!fs.existsSync(lock)) {
      restoreFromBackup();
      return;
    }
    const owner = fs.readFileSync(lock, "utf8").trim();
    if (!pidAlive(owner)) restoreFromBackup();
    return;
  }

  try {
    fs.mkdirSync(holdDir, { recursive: true });
    const fd = fs.openSync(lock, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    return;
  }

  const original = fs.readFileSync(live, "utf8");
  fs.writeFileSync(backup, original);
  if (!original.includes("export const dynamicParams")) {
    fs.writeFileSync(
      live,
      [
        "export const dynamicParams = false;",
        "export function generateStaticParams() {",
        '  return [{ canal: "sistema" }, { canal: "supervisor" }, { canal: "cobrador" }];',
        "}",
        original,
      ].join("\n"),
    );
  }
  process.once("exit", () => {
    try {
      restoreFromBackup();
    } catch (error) {
      console.error("hostinger-canal-restore", error);
    }
  });
}

const PUBLIC_SUPABASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** Lee KEY=VALUE. .env.local pisa a .env. No copia service_role al cliente. */
function readEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadPublicSupabaseEnv(root: string) {
  const merged = {
    ...readEnvFile(path.join(root, ".env")),
    ...readEnvFile(path.join(root, ".env.local")),
  };
  const picked: Record<(typeof PUBLIC_SUPABASE_KEYS)[number], string> = {
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  };
  for (const key of PUBLIC_SUPABASE_KEYS) {
    const value = (merged[key] || process.env[key] || "").trim();
    if (!value) continue;
    process.env[key] = value;
    picked[key] = value;
  }
  return picked;
}

const projectRoot = adminRoot();
const publicSupabaseEnv = hostingerExport ? loadPublicSupabaseEnv(projectRoot) : null;
if (hostingerExport && publicSupabaseEnv) {
  const missing = PUBLIC_SUPABASE_KEYS.filter((key) => !publicSupabaseEnv[key]);
  if (missing.length > 0) {
    throw new Error(
      `Export Hostinger: faltan ${missing.join(", ")} en .env o .env.local`,
    );
  }
}
if (hostingerExport) publishStaticManifest(projectRoot);
else {
  // app/manifest.ts es el único. Un archivo en public choca y deja el aviso rojo.
  const stray = path.join(projectRoot, "public", "manifest.webmanifest");
  if (fs.existsSync(stray)) fs.rmSync(stray);
}
syncCanalPageForExport(projectRoot);

const nextConfig: NextConfig = {
  ...(hostingerExport
    ? {
        output: "export" as const,
        distDir: ".next-hostinger",
        // Vistas = page.tsx. Rutas de servidor = route.ts. Sin `.ts` el export no empaqueta /api.
        pageExtensions: ["tsx", "jsx", "js", "mdx"],
      }
    : {}),
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_BUILD: APP_BUILD,
    ...(publicSupabaseEnv
      ? {
          NEXT_PUBLIC_SUPABASE_URL: publicSupabaseEnv.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: publicSupabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        }
      : {}),
  },
  // Evita pantalla negra al abrir http://127.0.0.1:3000 en Chrome (Next 16).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(hostingerExport
    ? {}
    : {
        async headers() {
          const noStore = [
            { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
            { key: "CDN-Cache-Control", value: "no-store" },
            { key: "Vercel-CDN-Cache-Control", value: "no-store" },
          ];
          return [
            { source: "/", headers: noStore },
            { source: "/index", headers: noStore },
            { source: "/manifest.webmanifest", headers: noStore },
            // Documento HTML de la app (evita shell viejo en celular / CDN).
            { source: "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)", headers: noStore },
            {
              source: "/pwa/manifests/:path*",
              headers: [
                { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
                { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
                { key: "X-Content-Type-Options", value: "nosniff" },
              ],
            },
            {
              source: "/pwa/icons/:path*",
              headers: [
                { key: "Cache-Control", value: "public, max-age=86400, immutable" },
                { key: "X-Content-Type-Options", value: "nosniff" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
