import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mini CRM de Prospecção com IA",
  description:
    "Plataforma de prospecção que qualifica leads automaticamente com IA via WhatsApp.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
            {children}
          </main>
          <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-400">
            Mini CRM de Prospecção com IA · WhatsApp & Calendar em modo mock ·
            IA real (Anthropic)
          </footer>
        </div>
      </body>
    </html>
  );
}
