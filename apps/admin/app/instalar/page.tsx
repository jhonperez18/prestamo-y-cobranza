import { redirect } from "next/navigation";

/** Sin pantalla intermedia: el login de siempre es la entrada. */
export default function InstalarHubRedirect() {
  redirect("/");
}
