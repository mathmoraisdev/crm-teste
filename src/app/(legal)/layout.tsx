import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/app/Logo";

/**
 * Layout das páginas legais (Privacidade, Termos, Cookies). Cabeçalho com a
 * marca e link de volta para a landing, conteúdo centrado num container estreito
 * e rodapé simples — coerente com o visual público do app.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-ink">
      {/* NAV */}
      <header className="sticky top-0 z-50 border-b border-[rgba(10,27,20,.06)] bg-slate-50/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-[820px] items-center justify-between px-6 py-4 md:px-8">
          <Link href="/" aria-label="Voltar para a página inicial">
            <Logo size="lg" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition-colors hover:text-ink"
          >
            <ArrowLeft size={16} /> Voltar ao início
          </Link>
        </div>
      </header>

      {/* CONTEÚDO */}
      <main className="mx-auto w-full max-w-[820px] px-6 py-14 md:px-8 md:py-20">
        {children}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[rgba(10,27,20,.07)] bg-white">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-4 px-6 py-8 md:px-8">
          <Logo />
          <div className="flex flex-wrap items-center gap-5 text-[13.5px] font-semibold text-slate-600">
            <Link href="/privacidade" className="hover:text-ink">Privacidade</Link>
            <Link href="/termos" className="hover:text-ink">Termos</Link>
            <Link href="/cookies" className="hover:text-ink">Cookies</Link>
          </div>
        </div>
        <div className="mx-auto max-w-[820px] border-t border-[#F0F3F1] px-6 py-5 md:px-8">
          <span className="text-[13px] text-slate-400">
            © 2026 Disparador.ai · Todos os direitos reservados
          </span>
        </div>
      </footer>
    </div>
  );
}
