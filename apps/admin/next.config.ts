import type { NextConfig } from "next";
import { execSync } from "child_process";

/** Commit corto del build — siempre el de Git/Vercel, nunca un archivo viejo. */
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
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
