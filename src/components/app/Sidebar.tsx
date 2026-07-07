"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Smartphone, LogOut, Menu, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/app/Logo";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { buildNav, type NavItem } from "@/lib/nav";
import type { BusinessCategory } from "@/lib/business-templates";

export function Sidebar({
  isAdmin = false,
  isAccountAdmin = false,
  category = null,
  branding,
}: {
  isAdmin?: boolean; // admin DA PLATAFORMA (Administração)
  isAccountAdmin?: boolean; // dono/ADMIN DA CONTA (Equipe)
  category?: BusinessCategory | null; // ramo da conta (Fase 3); null = mostra tudo
  branding?: { logoUrl: string | null; appName: string }; // marca da conta (null = padrão)
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [inboxBadge, setInboxBadge] = useState(0);
  const [financeiroBadge, setFinanceiroBadge] = useState(0);
  const [consultoresBadge, setConsultoresBadge] = useState(0);
  const [agendaBadge, setAgendaBadge] = useState(0);

  // Badge de "Atendimento" = fila + não-lidas. Polling leve.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/inbox?filter=fila", { cache: "no-store" });
        const data = await res.json();
        if (active && data.counts) {
          setInboxBadge((data.counts.fila ?? 0) + (data.counts.naoLidas ?? 0));
        }
      } catch {
        // ignora
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Badge de "Agenda" = agendamentos cuja resposta do cliente ao lembrete aguarda
  // conferência (needsReview). Polling leve, igual ao de Atendimento.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/appointments/review-count", { cache: "no-store" });
        const data = await res.json();
        if (active && typeof data.count === "number") setAgendaBadge(data.count);
      } catch {
        // ignora
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Badge de "Financeiro" = avisos não lidos (cancelamentos/exclusões). Só admin.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/notices/count", { cache: "no-store" });
        const data = await res.json();
        if (active && typeof data.count === "number") setFinanceiroBadge(data.count);
      } catch {
        // ignora
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [isAdmin, pathname]);

  // Badge de "Consultores" = leads novos do funil de consultor. Só admin.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/consultant/leads/count", { cache: "no-store" });
        const data = await res.json();
        if (active && typeof data.count === "number") setConsultoresBadge(data.count);
      } catch {
        // ignora
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [isAdmin, pathname]);
  // Estrutura de navegação vem de `buildNav` (dado puro, testável). Equipe é do
  // dono da conta; Administração é do admin da plataforma.
  const navGroups = buildNav({ isAdmin, isAccountAdmin, category });

  // Render de um item de nav (reusado nos grupos normais e no "Mais").
  const renderNavItem = ({ href, label, icon: Icon, badge }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    const badgeCount =
      badge === "inbox"
        ? inboxBadge
        : badge === "financeiro"
          ? financeiroBadge
          : badge === "consultores"
            ? consultoresBadge
            : badge === "agenda"
              ? agendaBadge
              : 0;
    const showBadge = !!badge && badgeCount > 0;
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
          active ? "bg-brand-300/12 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
        )}
      >
        <Icon size={17} className={active ? "text-mint" : ""} />
        <span className="flex-1">{label}</span>
        {showBadge && (
          <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-bold text-forest">
            {badgeCount}
          </span>
        )}
      </Link>
    );
  };

  // Fecha o drawer ao navegar (mobile).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // segue para o login de qualquer forma
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* Barra superior — só no mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-forest px-4 py-3 lg:hidden">
        <Link href="/leads" aria-label="Início">
          <Logo dark logoUrl={branding?.logoUrl} appName={branding?.appName} />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* Backdrop do drawer — só no mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      {/* Sidebar (desktop) / drawer (mobile) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-none flex-col bg-forest p-4 transition-transform duration-200 ease-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-60 lg:translate-x-0 lg:transition-none",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
      >
        <div className="flex flex-none items-center justify-between px-2 pb-4 pt-1.5">
          <Link href="/leads">
            <Logo dark logoUrl={branding?.logoUrl} appName={branding?.appName} />
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="scroll-overlay -mr-1.5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1.5">
          {navGroups.map((group) =>
            // "Mais" (módulos fora do ramo) = seção colapsada por padrão. Nada
            // some: fica a um clique. Demais grupos renderizam abertos.
            group.title === "Mais" ? (
              <details
                key={group.title}
                // Colapsado por padrão; abre sozinho se a rota atual está aqui
                // dentro (senão o item ativo ficaria escondido).
                open={group.items.some(
                  (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
                )}
                className="group/mais flex flex-col gap-1"
              >
                <summary className="flex cursor-pointer list-none items-center gap-1 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45 transition-colors hover:text-white/70 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={12} className="transition-transform group-open/mais:rotate-90" />
                  {group.title}
                </summary>
                <div className="flex flex-col gap-1">{group.items.map(renderNavItem)}</div>
              </details>
            ) : (
              <div key={group.title} className="flex flex-col gap-1">
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                  {group.title}
                </p>
                {group.items.map(renderNavItem)}
              </div>
            ),
          )}
        </nav>

        <div className="mt-3 flex flex-none flex-col gap-2.5 border-t border-white/[.06] pt-3">
          <Link
            href="/empresas"
            className="rounded-2xl border border-white/[.07] bg-white/[.04] p-3.5 transition-colors hover:bg-white/[.07]"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-bold text-white">
              <Smartphone size={14} className="text-mint" /> Empresas &amp; atendimentos
            </span>
            <span className="mt-1 block font-mono text-[11.5px] text-white/70">
              Conectar &amp; gerenciar chips
            </span>
          </Link>

          <ThemeToggle />

          <button
            onClick={logout}
            disabled={loggingOut}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            <LogOut size={17} /> Sair
          </button>
        </div>
      </aside>
    </>
  );
}
