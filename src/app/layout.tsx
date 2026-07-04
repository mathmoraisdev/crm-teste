import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope, DM_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/app/PostHogProvider";

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

export const metadata: Metadata = {
  title: "Disparador.ai — IA que qualifica e agenda seus leads no WhatsApp",
  description:
    "Dispare campanhas em massa no WhatsApp e deixe a IA responder, qualificar cada lead e marcar reuniões — tudo num CRM em tempo real.",
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
