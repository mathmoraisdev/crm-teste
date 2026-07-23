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
  ShoppingBag,
  ScrollText,
  PhoneCall,
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
  menuEnabled?: boolean; // cardápio online publicado → destrava Pedidos/Produção fora da alimentação
};

// Descreve um item com o papel/condição que o torna visível. `show`
// undefined ⇒ sempre visível. O filtro por papel vive DENTRO de buildNav.
// `show` = gate por papel/ramo hard (item some se false). `key` = módulo
// "primário" cuja relevância varia por ramo: se não visível, o item não some —
// cai no grupo "Mais" (colapsável). Os dois campos são internos ao buildNav.
type NavItemSpec = NavItem & { show?: boolean; key?: string };

// Regra de visibilidade por ramo (Fase 3). Só os módulos "primários" cujo uso
// varia por ramo têm regra; os demais (sem entrada aqui) aparecem sempre.
// Chave = "moduleKey" do item de nav. Valor = categorias onde ele é primário.
const MODULE_RULES: Record<string, BusinessCategory[]> = {
  // Comanda de cozinha: só faz sentido em alimentação.
  producao: ["alimentacao"],
  // Agenda (hora marcada): ramos de serviço/atendimento, não varejo/alimentação.
  agenda: [
    "saude",
    "beleza",
    "automotivo",
    "casa",
    "educacao",
    "servicos-pro",
    "fitness",
    "eventos",
    "imoveis-turismo",
  ],
  // Estoque físico: ramos que carregam produto (não serviços puros).
  estoque: ["varejo", "alimentacao", "automotivo", "beleza"],
};

/**
 * Um módulo é visível "de primeira" para uma categoria? Fail-open:
 * sem regra ⇒ sempre visível; categoria null/desconhecida ⇒ visível (nunca
 * prende o usuário). Módulos fora do ramo não somem — vão para o grupo "Mais".
 */
export function moduleVisibleFor(category: BusinessCategory | null, moduleKey: string): boolean {
  const rules = MODULE_RULES[moduleKey];
  if (!rules) return true;
  if (category == null) return true;
  return rules.includes(category);
}

export function buildNav(ctx: NavCtx): NavGroup[] {
  const { isAdmin, isAccountAdmin, category } = ctx;
  // Pedidos online e Produção (comanda de cozinha) são primários na alimentação,
  // mas também para QUALQUER conta que publicou o cardápio online (menuEnabled) —
  // ex.: ramos não-alimentícios usando delivery. Sem isto, quem liga o cardápio
  // recebe pedidos mas não vê a fila no menu.
  const isFood = category === "alimentacao";
  const showOrders = isFood || ctx.menuEnabled === true;

  const groups: { title: string; items: NavItemSpec[] }[] = [
    {
      title: "Operação",
      items: [
        { href: "/painel", label: "Painel", icon: LayoutDashboard },
        { href: "/inbox", label: "Atendimento", icon: Inbox, badge: "inbox" },
        { href: "/agenda", label: "Agenda", icon: CalendarClock, badge: "agenda", key: "agenda" },
        { href: "/caixa", label: "Caixa", icon: Receipt },
        { href: "/pedidos", label: "Pedidos online", icon: ShoppingBag, show: showOrders },
        { href: "/producao", label: "Produção", icon: ChefHat, show: showOrders },
      ],
    },
    {
      title: "Clientes",
      items: [
        { href: "/leads", label: "Leads", icon: Users },
        { href: "/leads/prioridade", label: "Fila de ligações", icon: PhoneCall },
        { href: "/clientes", label: "Clientes", icon: Contact },
        { href: "/empresas", label: "Empresas", icon: Building2 },
        { href: "/campaigns", label: "Campanhas", icon: Send },
      ],
    },
    {
      title: "Catálogo & Estoque",
      items: [
        { href: "/catalogo", label: "Catálogo", icon: Package },
        { href: "/estoque", label: "Estoque", icon: Boxes, key: "estoque" },
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
        { href: "/auditoria", label: "Auditoria", icon: ScrollText, show: isAccountAdmin },
        { href: "/consultores", label: "Consultores", icon: Headset, badge: "consultores", show: isAdmin },
        { href: "/financeiro", label: "Administração", icon: Wallet, badge: "financeiro", show: isAdmin },
        { href: "/configuracoes", label: "Configurações", icon: Settings },
      ],
    },
  ];

  // Itens de módulo fora do ramo não somem: são coletados aqui e reaparecem no
  // grupo "Mais" (colapsável na UI). Itens de papel (show) e sem key nunca vão.
  const mais: NavItem[] = [];
  const strip = ({ show: _show, key: _key, ...item }: NavItemSpec): NavItem => item;

  const built = groups
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter((i) => i.show !== false)
        .filter((i) => {
          if (i.key && !moduleVisibleFor(category, i.key)) {
            mais.push(strip(i));
            return false;
          }
          return true;
        })
        .map(strip),
    }))
    .filter((g) => g.items.length > 0);

  if (mais.length > 0) built.push({ title: "Mais", items: mais });
  return built;
}
