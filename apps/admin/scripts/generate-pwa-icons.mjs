/**
 * Genera iconos PWA brandados desde public/logo-ca-prestamo.png
 * Uso: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = join(root, "public", "logo-ca-prestamo.png");
const outDir = join(root, "public", "pwa", "icons");
const BRAND = { r: 15, g: 118, b: 110, alpha: 1 }; // #0f766e

mkdirSync(outDir, { recursive: true });

async function squareIcon(size, fileName, { maskable = false } = {}) {
  const pad = maskable ? 0.22 : 0.14;
  const logoSize = Math.round(size * (1 - pad * 2));
  const radius = Math.round(size * 0.18);
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="${radius}" fill="rgb(${BRAND.r},${BRAND.g},${BRAND.b})"/>
    </svg>`,
  );

  const out = join(outDir, fileName);
  await sharp(svg)
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(out);
  console.log("OK", fileName);
}

await squareIcon(192, "icon-192.png");
await squareIcon(512, "icon-512.png");
await squareIcon(180, "apple-touch-180.png");
await squareIcon(512, "maskable-512.png", { maskable: true });
console.log("Iconos PWA listos en public/pwa/icons/");
