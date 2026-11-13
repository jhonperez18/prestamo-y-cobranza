/**
 * Candado anti-cruce de catálogo (prebuild).
 * Solo autoprestamos.org y localhost:3000 pueden mutar rutas/usuarios/cuentas.
 */
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const {
  evaluateCatalogWriteGate,
  isCatalogOpsMirrorKind,
  isAllowedCatalogOrigin,
  canonicalOrigin,
} = await import("@/lib/catalog-write-guard");

function expect(label, got, want) {
  if (got !== want) {
    console.error(`FALLO: ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

expect("prod origin ok", evaluateCatalogWriteGate({ origin: "https://autoprestamos.org" }).ok, true);
expect("taller 3000 ok", evaluateCatalogWriteGate({ origin: "http://localhost:3000" }).ok, true);
expect("taller 127 ok", evaluateCatalogWriteGate({ origin: "http://127.0.0.1:3000" }).ok, true);
expect("3010 bloqueado", evaluateCatalogWriteGate({ origin: "http://localhost:3010" }).ok, false);
expect("otro dominio bloqueado", evaluateCatalogWriteGate({ origin: "https://evil.example" }).ok, false);
expect(
  "referer prod ok",
  evaluateCatalogWriteGate({ referer: "https://autoprestamos.org/login" }).ok,
  true,
);
expect(
  "host prod sin origin ok",
  evaluateCatalogWriteGate({ host: "autoprestamos.org" }).ok,
  true,
);
expect(
  "host 3010 sin origin bloqueado",
  evaluateCatalogWriteGate({ host: "localhost:3010" }).ok,
  false,
);
expect("route es catálogo", isCatalogOpsMirrorKind("route"), true);
expect("route_delete es catálogo", isCatalogOpsMirrorKind("route_delete"), true);
expect("collector es catálogo", isCatalogOpsMirrorKind("collector"), true);
expect("payment NO es catálogo", isCatalogOpsMirrorKind("payment"), false);
expect("assignment NO es catálogo", isCatalogOpsMirrorKind("assignment"), false);
expect("day_close NO es catálogo", isCatalogOpsMirrorKind("day_close"), false);
expect("origin canonical", canonicalOrigin("https://autoprestamos.org/foo"), "https://autoprestamos.org");
expect("allowed prod", isAllowedCatalogOrigin("https://autoprestamos.org"), true);
expect("not allowed 3010", isAllowedCatalogOrigin("http://localhost:3010"), false);

const blocked = evaluateCatalogWriteGate({ origin: "http://localhost:3010" });
expect("error code", blocked.ok ? "" : blocked.error, "catalog_origin_blocked");

console.log("OK: candado anti-cruce catálogo (prod + :3000 sí · :3010 no · cobros no).");
