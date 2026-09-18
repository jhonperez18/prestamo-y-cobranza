import { redirect } from "next/navigation";

/** Canales futuros = subdominio; hoy todos entran por el mismo login. */
export default async function InstalarCanalRedirect({
  params,
}: {
  params: Promise<{ canal: string }>;
}) {
  await params;
  redirect("/");
}
