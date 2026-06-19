import type { Metadata } from "next";
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
  title: "Disparador.ai — Disparos em massa no WhatsApp que vendem",
  description:
    "Envie campanhas para milhares de clientes no WhatsApp, acompanhe cada resposta num CRM simples e transforme sua lista de contatos em faturamento.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen font-sans">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
