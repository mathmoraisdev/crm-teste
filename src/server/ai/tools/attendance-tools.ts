import { formatCentsBRL } from "@/lib/money";
import { listCatalogItems } from "@/server/services/catalog.service";
import { sendWhatsAppMessage } from "@/server/services/messaging";
import { renderCatalogForTools } from "../attendance-context";
import type { ToolDef, ToolResult } from "../provider";

/**
 * Contexto que a fábrica de tools recebe para decidir QUAIS tools registrar e
 * fechar os handlers sobre o lead/conta. Forma FIXA (fases seguintes só populam
 * mais flags; a assinatura não muda).
 */
export interface AttendanceToolCtx {
  lead: {
    id: string;
    phone: string;
    userId: string;
    whatsAppNumberId: string | null;
    name: string;
  };
  /** = lead.userId (id do tenant/conta dona do catálogo). */
  accountId: string;
  company: {
    salesEnabled?: boolean;
    scheduleEnabled?: boolean;
    qualifyEnabled?: boolean;
  } | null;
  /** Conta tem CatalogItem ativo → habilita `criar_comanda` (Fase 3). */
  hasCatalog: boolean;
  /** Conta tem MediaAsset → habilita `enviar_midia` (Fase 5). false por ora. */
  hasMedia: boolean;
}

/** Lê `query?: string` de um args cru sem estourar em formato inesperado. */
function readQuery(args: unknown): string | undefined {
  if (args && typeof args === "object" && "query" in args) {
    const q = (args as { query?: unknown }).query;
    if (typeof q === "string" && q.trim()) return q.trim();
  }
  return undefined;
}

/** Catálogo voltado ao CLIENTE (WhatsApp): sem ids, nome + preço. Vazio → "". */
function renderCatalogForCustomer(
  items: { name: string; priceCents: number }[],
): string {
  if (!items.length) return "";
  const linhas = items.map((i) => {
    const price = i.priceCents > 0 ? formatCentsBRL(i.priceCents) : "sob consulta";
    return `• ${i.name} — ${price}`;
  });
  return `Nosso catálogo:\n${linhas.join("\n")}`;
}

/** Handler read-only: consulta o catálogo/estoque ao vivo (7.3, sem cap de 40). */
function consultarEstoque(ctx: AttendanceToolCtx): ToolDef {
  return {
    name: "consultar_estoque",
    description:
      "Consulta o catálogo e o estoque ao vivo da empresa. Use para responder preço/disponibilidade " +
      "e para descobrir o id de um item antes de abrir uma comanda. Aceita um termo de busca opcional.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Filtro por nome do item (opcional)." },
      },
    },
    handler: async (args): Promise<ToolResult> => {
      const query = readQuery(args);
      const items = await listCatalogItems(ctx.accountId, { activeOnly: true });
      const filtered = query
        ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
        : items;
      const render = renderCatalogForTools(
        filtered.map((i) => ({
          id: i.id,
          name: i.name,
          priceCents: i.priceCents,
          kind: i.kind,
          trackStock: i.trackStock,
          stockQty: i.stockQty,
        })),
      );
      return {
        content: render || (query ? `Nenhum item encontrado para "${query}".` : "Catálogo vazio."),
      };
    },
  };
}

/** Handler: envia o catálogo voltado ao cliente pelo WhatsApp (sem PDF ainda). */
function enviarCatalogo(ctx: AttendanceToolCtx): ToolDef {
  return {
    name: "enviar_catalogo",
    description:
      "Envia ao cliente, pelo WhatsApp, a lista de produtos/serviços com preços. " +
      "Use quando ele pedir o cardápio/catálogo/tabela.",
    jsonSchema: { type: "object", additionalProperties: false, properties: {} },
    handler: async (): Promise<ToolResult> => {
      const items = await listCatalogItems(ctx.accountId, { activeOnly: true });
      const texto = renderCatalogForCustomer(items);
      if (!texto) return { content: "O catálogo está vazio; não há o que enviar." };
      await sendWhatsAppMessage(ctx.lead, texto);
      // Sem `stop`: a IA pode complementar com uma frase depois de enviar.
      return { content: "catálogo enviado" };
    },
  };
}

/**
 * Fábrica das tools de atendimento. Decide INTERNAMENTE quais registrar a partir
 * do `ctx`. Nesta fase (2) devolve SEMPRE as duas read-only (não dependem de
 * flag); fases seguintes adicionam `criar_comanda`/`escalar_humano`/`enviar_midia`.
 */
export function buildAttendanceTools(ctx: AttendanceToolCtx): ToolDef[] {
  return [consultarEstoque(ctx), enviarCatalogo(ctx)];
}
