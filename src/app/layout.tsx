import type { Metadata } from "next";
import Link from "next/link";
import { Users, Megaphone, Bot } from "lucide-react";
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
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <Link href="/leads" className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
                  <Bot size={18} />
                </span>
                <span className="text-lg font-semibold tracking-tight">
                  Prospecta<span className="text-brand-600">IA</span>
                </span>
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                <Link
                  href="/leads"
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Users size={16} /> Leads
                </Link>
                <Link
                  href="/campaigns"
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Megaphone size={16} /> Campanhas
                </Link>
              </nav>
            </div>
          </header>
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
