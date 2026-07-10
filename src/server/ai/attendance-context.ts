import { formatCentsBRL } from "@/lib/money";
import type {
  BookableProfessional,
  BookableService,
} from "@/server/services/booking-availability.service";

/**
 * Monta (PURA) o bloco de contexto da empresa para o prompt de atendimento.
 * Omite seções ausentes para não poluir o prompt com "null".
 */
export function buildAttendanceContext(c: {
  displayName?: string | null;
  persona?: string | null;
  knowledgeBase?: string | null;
  businessHours?: string | null;
}): string {
  const parts: string[] = [];
  if (c.displayName) parts.push(`Empresa: ${c.displayName}`);
  if (c.persona) parts.push(`Persona/estilo: ${c.persona}`);
  if (c.businessHours) parts.push(`Horário de atendimento: ${c.businessHours}`);
  if (c.knowledgeBase) parts.push(`Base de conhecimento:\n${c.knowledgeBase}`);
  return parts.join("\n\n");
}

/** Oferta reduzida ao que a IA precisa ver no contexto. */
export interface OfferForContext {
  id: string;
  name: string;
  priceCents: number;
  description?: string | null;
}

/**
 * Renderiza (PURA) as ofertas ativas como bloco estruturado para o prompt.
 * A IA escolhe o `id`; o preço é fixo (fonte de verdade no banco). String vazia
 * quando não há ofertas — o chamador omite o bloco.
 */
export function renderActiveOffers(offers: OfferForContext[]): string {
  if (!offers.length) return "";
  const lines = offers.map((o) => {
    const price = formatCentsBRL(o.priceCents);
    const desc = o.description?.trim() ? ` | ${o.description.trim()}` : "";
    return `- id=${o.id} | ${o.name} | ${price}${desc}`;
  });
  return `OFERTAS DISPONÍVEIS (use o id ao escolher; o preço é fixo, não altere):\n${lines.join("\n")}`;
}

/** Grupo de adicionais reduzido ao que a IA precisa mencionar (nome + Δpreço). */
export interface ModifierGroupForContext {
  name: string;
  options: { name: string; priceDeltaCents: number }[];
}

/** Resumo textual (PURO) dos grupos p/ o prompt: "Tamanho: Média, Grande (+R$8);
 * Extras: Bacon (+R$5)". Delta 0 não mostra preço. Vazio → "". */
export function renderModifierSummary(groups?: ModifierGroupForContext[]): string {
  if (!groups?.length) return "";
  return groups
    .map((g) => {
      const opts = g.options
        .map((o) => (o.priceDeltaCents > 0 ? `${o.name} (+${formatCentsBRL(o.priceDeltaCents)})` : o.name))
        .join(", ");
      return `${g.name}: ${opts}`;
    })
    .join("; ");
}

export interface CatalogItemForContext {
  name: string;
  priceCents: number;
  kind: "SERVICO" | "PRODUTO";
  /** Opcionais: quando ausentes, o item é sempre tratado como disponível (retrocompat). */
  trackStock?: boolean;
  stockQty?: number;
  /** Adicionais precificados (onda-N): grupos p/ a IA oferecer/confirmar as opções. */
  modifierGroups?: ModifierGroupForContext[];
}

/**
 * Renderiza (PURA) o catálogo ativo da conta como bloco de contexto — para a IA
 * conhecer serviços/produtos e responder dúvidas. Preço só quando > 0 (item sem
 * preço definido = "sob consulta"). Vazio quando não há itens (chamador omite).
 */
export function renderCatalogForAI(items: CatalogItemForContext[], limit = 40): string {
  if (!items.length) return "";
  const lines = items.slice(0, limit).map((i) => {
    const price = i.priceCents > 0 ? formatCentsBRL(i.priceCents) : "sob consulta";
    // Só marca esgotado quando o item controla estoque (opt-in) e zerou/negativou.
    // NÃO expõe a quantidade — só disponível vs indisponível (decisão v1).
    const soldOut = i.trackStock && (i.stockQty ?? 0) <= 0;
    const mark = soldOut ? " — INDISPONÍVEL (sem estoque)" : "";
    const mods = renderModifierSummary(i.modifierGroups);
    const modsText = mods ? ` | opções: ${mods}` : "";
    return `- ${i.name}: ${price}${mark}${modsText}`;
  });
  return `SERVIÇOS E PRODUTOS (catálogo da empresa; informe preço só se listado):\n${lines.join("\n")}`;
}

/**
 * Renderiza (PURA) a biblioteca de mídia da conta p/ o prompt do loop — a IA
 * escolhe o `assetId` ao chamar `enviar_midia` (igual às ofertas). Vazio → "".
 */
export function renderMediaAssetsForAI(assets: { id: string; label: string }[]): string {
  if (!assets.length) return "";
  const linhas = assets.map((a) => `- assetId=${a.id} | ${a.label}`);
  return `MÍDIAS DISPONÍVEIS (envie com enviar_midia usando o assetId):\n${linhas.join("\n")}`;
}

/**
 * Renderiza (PURA) o bloco AGENDAMENTO da Agenda Pro para o prompt do loop — dá à
 * IA os `serviceId`/`professionalId` REAIS que a tool `agendar` recebe (nunca
 * inventar id) e, quando há, o link público de autoatendimento como caminho
 * alternativo. Serviço traz preço + duração; profissional só id + nome. Vazio → ""
 * (sem serviço agendável E sem link o chamador omite o bloco inteiro).
 */
export function renderBookingContext(opts: {
  services: BookableService[];
  professionals: BookableProfessional[];
  bookingUrl?: string | null;
}): string {
  const { services, professionals, bookingUrl } = opts;
  if (services.length === 0 && !bookingUrl) return "";

  const parts: string[] = [
    "AGENDAMENTO (marque com a tool agendar usando os ids abaixo; nunca invente id nem horário):",
  ];
  if (services.length) {
    const linhas = services.map((s) => {
      const price = s.priceCents > 0 ? formatCentsBRL(s.priceCents) : "sob consulta";
      return `- serviceId=${s.id} | ${s.name} | ${price} | ${s.durationMinutes}min`;
    });
    parts.push(`Serviços agendáveis:\n${linhas.join("\n")}`);
  }
  if (professionals.length) {
    const linhas = professionals.map((p) => `- professionalId=${p.id} | ${p.name}`);
    parts.push(`Profissionais (opcional; ausente = sem preferência):\n${linhas.join("\n")}`);
  }
  if (bookingUrl) {
    parts.push(`Link de autoatendimento: ${bookingUrl}`);
  }
  return parts.join("\n\n");
}

export interface CatalogItemForTools {
  id: string;
  name: string;
  priceCents: number;
  kind: "SERVICO" | "PRODUTO";
  /** Opcionais: quando ausentes, o item é sempre tratado como disponível (retrocompat). */
  trackStock?: boolean;
  stockQty?: number;
  /** Ficha técnica (specs) do anúncio — valores dos CustomFieldDef scope=PRODUCT. */
  customFields?: Record<string, unknown> | null;
  /** Adicionais precificados (onda-N): grupos p/ a IA oferecer/confirmar as opções. */
  modifierGroups?: ModifierGroupForContext[];
}

/**
 * Renderiza (PURA) o catálogo para as TOOLS do agente — diferente de
 * `renderCatalogForAI`: EXPÕE o `id` (a IA referencia o item p/ abrir comanda) e
 * o SALDO de estoque (leitura ao vivo, 7.3), e NÃO tem cap de 40 (a tool é
 * chamada sob demanda, não vive no prompt). Uma linha por item:
 *   `id=<id> | <nome> | <preço|sob consulta> | estoque=<n|—>[ — INDISPONÍVEL]`.
 * Vazio → "" (o handler responde "catálogo vazio").
 */
export function renderCatalogForTools(items: CatalogItemForTools[]): string {
  if (!items.length) return "";
  const lines = items.map((i) => {
    const price = i.priceCents > 0 ? formatCentsBRL(i.priceCents) : "sob consulta";
    const tracks = i.trackStock === true;
    const stock = tracks ? String(i.stockQty ?? 0) : "—";
    const soldOut = tracks && (i.stockQty ?? 0) <= 0;
    const mark = soldOut ? " — INDISPONÍVEL" : "";
    // Ficha técnica (specs) do anúncio, só no caminho ativo da tool (custo por token
    // sob demanda, não no bloco passivo). Ausente/vazia → não anexa nada.
    const specs =
      i.customFields && typeof i.customFields === "object"
        ? Object.entries(i.customFields)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "";
    const ficha = specs ? ` | ficha: ${specs}` : "";
    const mods = renderModifierSummary(i.modifierGroups);
    const modsText = mods ? ` | opções: ${mods}` : "";
    return `id=${i.id} | ${i.name} | ${price} | estoque=${stock}${mark}${ficha}${modsText}`;
  });
  return lines.join("\n");
}
