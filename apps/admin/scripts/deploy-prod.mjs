import { execSync } from "child_process";

const DOMAIN = "prestamo-y-cobranza.vercel.app";

const out = execSync("npx vercel deploy --prod --yes", {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
process.stdout.write(out);

const match = out.match(
  /https:\/\/admin-[a-z0-9]+-jhon-fredy-perezs-projects\.vercel\.app/,
);
if (!match) {
  console.error("No se encontró la URL del deploy. No se actualizó el dominio fijo.");
  process.exit(1);
}

execSync(`npx vercel alias set ${match[0]} ${DOMAIN}`, { stdio: "inherit" });
console.log(`\nListo → https://${DOMAIN}`);
