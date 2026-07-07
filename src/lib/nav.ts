// Navegação como DADO testável. O array de grupos era hardcoded dentro de
// `Sidebar.tsx`; aqui vira uma função pura `buildNav(ctx)` que recebe papel +
// categoria do ramo + flags e devolve os grupos. O Sidebar só renderiza.
// A adaptação por ramo (Fase 3) usa `moduleVisibleFor`; por ora `category` é
// recebido mas sem efeito.

import {
  Users,
  UsersRound,
  Contact,
  Send,
  Building2,
  CalendarClock,
  Settings,
  Wallet,
  LayoutDashboard,
  Inbox,
  Headset,
  Receipt,
  Package,
  Boxes,
  BarChart3,
  TrendingDown,
  ChefHat,
} from "lucide-react";
import type { BusinessCategory } from "@/lib/business-templates";

export type NavBadge = "inbox" | "financeiro" | "consultores" | "agenda";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: NavBadge; // qual contador alimenta o badge deste item
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export type NavCtx = {
  isAdmin: boolean; // admin DA PLATAFORMA (Administração / billing SaaS)
  isAccountAdmin: boolean; // dono/ADMIN DA CONTA (Equipe)
  category: BusinessCategory | null; // ramo da conta (Fase 3); null = mostra tudo
};

// Descreve um item com o papel/condição que o torna visível. `show`
// undefined ⇒ sempre visível. O filtro por papel vive DENTRO de buildNav.
type NavItemSpec = NavItem & { show?: boolean };

export function buildNav(ctx: NavCtx): NavGroup[] {
  const { isAdmin, isAccountAdmin, category } = ctx;
  // Produção (comanda de cozinha) só faz sentido em ramos de alimentação.
  const isFood = category === "alimentacao";

  const groups: { title: string; items: NavItemSpec[] }[] = [
    {
      title: "Operação",
      items: [
        { href: "/painel", label: "Painel", icon: LayoutDashboard },
        { href: "/inbox", label: "Atendimento", icon: Inbox, badge: "inbox" },
        { href: "/agenda", label: "Agenda", icon: CalendarClock, badge: "agenda" },
        { href: "/caixa", label: "Caixa", icon: Receipt },
        { href: "/producao", label: "Produção", icon: ChefHat, show: isFood },
      ],
    },
    {
      title: "Clientes",
      items: [
        { href: "/leads", label: "Leads", icon: Users },
        { href: "/clientes", label: "Clientes", icon: Contact },
        { href: "/empresas", label: "Empresas", icon: Building2 },
        { href: "/campaigns", label: "Campanhas", icon: Send },
      ],
    },
    {
      title: "Catálogo & Estoque",
      items: [
        { href: "/catalogo", label: "Catálogo", icon: Package },
        { href: "/estoque", label: "Estoque", icon: Boxes },
      ],
    },
    {
      title: "Financeiro",
      items: [
        { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
        { href: "/despesas", label: "Despesas", icon: TrendingDown },
      ],
    },
    {
      title: "Conta",
      items: [
        { href: "/equipe", label: "Equipe", icon: UsersRound, show: isAccountAdmin },
        { href: "/consultores", label: "Consultores", icon: Headset, badge: "consultores", show: isAdmin },
        { href: "/financeiro", label: "Administração", icon: Wallet, badge: "financeiro", show: isAdmin },
        { href: "/configuracoes", label: "Configurações", icon: Settings },
      ],
    },
  ];

  return groups
    .map((g) => ({
      title: g.title,
      items: g.items.filter((i) => i.show !== false).map(({ show: _show, ...item }) => item),
    }))
    .filter((g) => g.items.length > 0);
}
