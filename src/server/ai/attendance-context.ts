import { formatCentsBRL } from "@/lib/money";

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

export interface CatalogItemForContext {
  name: string;
  priceCents: number;
  kind: "SERVICO" | "PRODUTO";
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
    return `- ${i.name}: ${price}`;
  });
  return `SERVIÇOS E PRODUTOS (catálogo da empresa; informe preço só se listado):\n${lines.join("\n")}`;
}
