import type { NextConfig } from "next";
import { execSync } from "child_process";

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

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_BUILD: APP_BUILD,
  },
  // Evita pantalla negra al abrir http://127.0.0.1:3000 en Chrome (Next 16).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
};

export default nextConfig;
