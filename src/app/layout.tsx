import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope, DM_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/app/PostHogProvider";
import { env } from "@/lib/env";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const sans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_TITLE = "Disparador.ai — Atenda e gerencie seu negócio no WhatsApp com IA";
const SITE_DESC =
  "A IA responde e qualifica cada cliente no WhatsApp enquanto você gerencia CRM, agenda, caixa, estoque e campanhas — tudo integrado num painel só.";

export const metadata: Metadata = {
  // Base p/ tornar as URLs de OG (incl. a opengraph-image) ABSOLUTAS — sem isso o
  // preview do WhatsApp não acha a imagem. Vem de APP_URL (localhost em dev, o
  // domínio em prod). Ver `[[app-url-vercel-localhost-links]]`.
  metadataBase: new URL(env.APP_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Disparador.ai",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* No-flash: aplica o tema salvo (ou a preferência do SO) antes do paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-surface font-sans text-ink">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
