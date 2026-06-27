import { redirect } from "next/navigation";
import { isLandingEnabled } from "@/server/services/settings.service";
import { Landing } from "@/components/marketing/Landing";

// A raiz é um roteador: o admin decide (em /financeiro) se mostra a landing de
// marketing ou manda direto pro login. Padrão = login (só captura/acesso).
// force-dynamic: a decisão é lida do banco a cada request, sem cache estático.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isLandingEnabled())) redirect("/login");
  return <Landing />;
}
