// Wrapper de analytics de produto (PostHog), client-side.
//
// - Com `NEXT_PUBLIC_POSTHOG_KEY` setada: inicializa o PostHog e envia eventos.
// - Sem a chave (dev local / build do avaliador): tudo vira no-op gracioso —
//   nada é carregado e nenhuma chamada quebra. Mesmo princípio do `sendEmail`
//   em "@/lib/email".
//
// É seguro chamar `capture()` antes de `initAnalytics()`; sem init (ou sem
// chave) a chamada simplesmente é ignorada.
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let started = false;

/** Inicializa o PostHog uma única vez. No-op sem chave ou fora do browser. */
export function initAnalytics() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;

  posthog.init(KEY, {
    api_host: HOST,
    // Capturamos pageviews manualmente onde fizer sentido; evita ruído no SPA.
    capture_pageview: false,
    // Respeita o "Do Not Track" do navegador.
    respect_dnt: true,
  });
}

/** Indica se o analytics está configurado (chave presente). */
export const isAnalyticsConfigured = Boolean(KEY);

/** Envia um evento de produto. No-op sem chave / antes do init. */
export function capture(event: string, props?: Record<string, unknown>) {
  if (!started || !KEY) return;
  try {
    posthog.capture(event, props);
  } catch {
    // Nunca derruba a UI por causa de telemetria.
  }
}
