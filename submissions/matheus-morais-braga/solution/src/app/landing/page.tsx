import type { Metadata } from "next";
import { Landing } from "@/components/marketing/Landing";

// Preview da landing de marketing, sempre acessível (mesmo quando a raiz "/"
// está indo direto pro login). Útil para revisar/testar antes de religar.
export const metadata: Metadata = {
  title: "Disparador.ai — Atenda e gerencie seu negócio no WhatsApp com IA",
};

// Mesmo motivo da raiz "/": a Landing usa client components (modais/toggle) que
// quebram o prerender estático no build. Renderiza sob demanda, como em page.tsx.
export const dynamic = "force-dynamic";

export default function LandingRoute() {
  return <Landing />;
}
