"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Users, UsersRound, Send, Building2, CalendarClock, Smartphone, Settings, LogOut, Wallet, Menu, X, LayoutDashboard, Inbox, Headset } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/app/Logo";

// Menu dividido por categorias. `show` (opcional) esconde o item;
// grupo sem itens visíveis não renderiza o cabeçalho.
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: "inbox" | "financeiro" | "consultores"; // qual contador alimenta o badge deste item
  show?: boolean;
};

export function Sidebar({
  isAdmin = false,
  isAccountAdmin = false,
  branding,
}: {
  isAdmin?: boolean; // admin DA PLATAFORMA (Financeiro)
  isAccountAdmin?: boolean; // dono/ADMIN DA CONTA (Equipe)
  branding?: { logoUrl: string | null; appName: string }; // marca da conta (null = padrão)
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [inboxBadge, setInboxBadge] = useState(0);
  const [financeiroBadge, setFinanceiroBadge] = useState(0);
  const [consultoresBadge, setConsultoresBadge] = useState(0);

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
  // Equipe é do dono da conta; Financeiro é do admin da plataforma.
  const navGroups = ([
    {
      title: "Atendimento",
      items: [
        { href: "/painel", label: "Painel", icon: LayoutDashboard },
        { href: "/inbox", label: "Atendimento", icon: Inbox, badge: "inbox" },
        { href: "/leads", label: "Leads", icon: Users },
      ],
    },
    {
      title: "Crescimento",
      items: [
        { href: "/campaigns", label: "Campanhas", icon: Send },
        { href: "/agenda", label: "Agenda", icon: CalendarClock },
      ],
    },
    {
      title: "Gestão",
      items: [
        { href: "/empresas", label: "Empresas", icon: Building2 },
        { href: "/equipe", label: "Equipe", icon: UsersRound, show: isAccountAdmin },
        { href: "/consultores", label: "Consultores", icon: Headset, badge: "consultores", show: isAdmin },
        { href: "/financeiro", label: "Financeiro", icon: Wallet, badge: "financeiro", show: isAdmin },
        { href: "/configuracoes", label: "Configurações", icon: Settings },
      ],
    },
  ] as { title: string; items: NavItem[] }[])
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) }))
    .filter((g) => g.items.length > 0);

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
        <div className="flex items-center justify-between px-2 pb-5 pt-1.5">
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

        <nav className="flex flex-col gap-5">
          {navGroups.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                {group.title}
              </p>
              {group.items.map(({ href, label, icon: Icon, badge }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                const badgeCount =
                  badge === "inbox"
                    ? inboxBadge
                    : badge === "financeiro"
                      ? financeiroBadge
                      : badge === "consultores"
                        ? consultoresBadge
                        : 0;
                const showBadge = !!badge && badgeCount > 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-brand-300/12 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white",
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
              })}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5">
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

          <button
            onClick={logout}
            disabled={loggingOut}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            <LogOut size={17} /> Sair
          </button>
        </div>
      </aside>
    </>
  );
}
