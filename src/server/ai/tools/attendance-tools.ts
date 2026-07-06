import { formatCentsBRL } from "@/lib/money";
import { listCatalogItems } from "@/server/services/catalog.service";
import { addItem, listOpenOrders, openOrder } from "@/server/services/order.service";
import { addNote } from "@/server/services/internal-note.service";
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

/** Lê `{ itens: [{ catalogItemId, quantidade? }] }` de um args cru, tolerante. */
function readItens(args: unknown): { catalogItemId: string; quantidade: number }[] {
  const raw =
    args && typeof args === "object" && "itens" in args
      ? (args as { itens?: unknown }).itens
      : undefined;
  if (!Array.isArray(raw)) return [];
  const out: { catalogItemId: string; quantidade: number }[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const id = (it as { catalogItemId?: unknown }).catalogItemId;
    if (typeof id !== "string" || !id.trim()) continue;
    const q = (it as { quantidade?: unknown }).quantidade;
    const quantidade = typeof q === "number" && q >= 1 ? Math.floor(q) : 1;
    out.push({ catalogItemId: id.trim(), quantidade });
  }
  return out;
}

/**
 * Handler `criar_comanda` (Fase 3): ABRE uma comanda (ou reusa a ABERTA do lead)
 * e adiciona os itens que a IA referenciou por id. NÃO fecha nem cobra (pagamento
 * fora do escopo v1). Idempotente por turno: reusa a comanda ABERTA mais recente
 * do lead p/ não duplicar quando a IA chama a tool duas vezes.
 */
function criarComanda(ctx: AttendanceToolCtx): ToolDef {
  return {
    name: "criar_comanda",
    description:
      "Abre uma comanda para o cliente e adiciona itens do catálogo (referenciados pelo id de " +
      "consultar_estoque). Use quando o cliente pedir/confirmar itens para consumo ou pedido. " +
      "Não cobra nem fecha a conta — só registra o pedido em aberto.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        itens: {
          type: "array",
          description: "Itens a adicionar na comanda.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              catalogItemId: { type: "string", description: "id do item (de consultar_estoque)." },
              quantidade: { type: "number", description: "quantidade (inteiro >= 1; default 1)." },
            },
            required: ["catalogItemId"],
          },
        },
      },
      required: ["itens"],
    },
    handler: async (args): Promise<ToolResult> => {
      const itens = readItens(args);
      if (!itens.length) return { content: "Nenhum item informado para a comanda." };

      // Idempotência: reusa a comanda ABERTA mais recente do lead, se houver.
      const open = await listOpenOrders(ctx.accountId);
      const existing = open.find((o) => o.leadId === ctx.lead.id);
      const reused = !!existing;
      const order =
        existing ??
        (await openOrder(ctx.accountId, { openedById: ctx.accountId, leadId: ctx.lead.id }));

      const naoEncontrados: string[] = [];
      let dto = order;
      for (const it of itens) {
        try {
          dto = await addItem(ctx.accountId, order.id, {
            catalogItemId: it.catalogItemId,
            quantity: it.quantidade,
          });
        } catch {
          // id inexistente / de outra conta → não estoura o loop; avisa amigável.
          naoEncontrados.push(it.catalogItemId);
        }
      }

      // Resumo a partir do estado final da comanda (sem "#nº": só no fechamento).
      const linhas = dto.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`);
      const resumo = linhas.length
        ? `${reused ? "Comanda atualizada" : "Comanda aberta"}: ${linhas.join(", ")} — total ${formatCentsBRL(dto.totalCents)}`
        : "Não consegui adicionar nenhum item à comanda.";
      const erro = naoEncontrados.length ? ` (não encontrei: ${naoEncontrados.join(", ")})` : "";
      return { content: `${resumo}${erro}` };
    },
  };
}

/** Lê `{ motivo?: string }` de um args cru. */
function readMotivo(args: unknown): string {
  if (args && typeof args === "object" && "motivo" in args) {
    const m = (args as { motivo?: unknown }).motivo;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return "sem motivo informado";
}

/**
 * Handler `escalar_humano` (Fase 4): a IA decide passar o atendimento para uma
 * pessoa. Move o lead p/ a FILA (setHandoff pausa a IA + inicia o SLA) e registra
 * o motivo como nota interna (best-effort). Encerra o turno (`stop:true`): o
 * humano assume e a IA não manda mais nada. NÃO envia mensagem automática ao
 * cliente (evita "vou te transferir" fantasma — a IA pode avisar ANTES de chamar).
 */
function escalarHumano(ctx: AttendanceToolCtx): ToolDef {
  return {
    name: "escalar_humano",
    description:
      "Transfere a conversa para um atendente humano. Use quando o cliente pedir uma pessoa, " +
      "fizer uma reclamação séria, ou o caso fugir do que você pode resolver. Informe o motivo.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        motivo: { type: "string", description: "Por que está escalando (curto)." },
      },
      required: ["motivo"],
    },
    handler: async (args): Promise<ToolResult> => {
      const motivo = readMotivo(args);
      // setHandoff mora em conversation.service, que importa esta fábrica — import
      // dinâmico evita o ciclo estático (resolve no runtime, dentro do handler).
      const { setHandoff } = await import("@/server/services/conversation.service");
      await setHandoff(ctx.lead.id, ctx.accountId, true);
      // Nota interna com o motivo (best-effort: falha aqui não desfaz a escalação).
      try {
        await addNote(ctx.accountId, ctx.lead.id, ctx.accountId, `🤖 IA escalou para humano: ${motivo}`);
      } catch {
        // ignora — a escalação (setHandoff) é o que importa
      }
      return { content: "escalado", stop: true };
    },
  };
}

/**
 * Fábrica das tools de atendimento. Decide INTERNAMENTE quais registrar a partir
 * do `ctx`. Read-only (consultar/enviar catálogo) e `escalar_humano` sempre
 * entram; `criar_comanda` só quando a conta usa o módulo de comanda (tem
 * CatalogItem — `hasCatalog`). A Fase 5 adiciona `enviar_midia`.
 */
export function buildAttendanceTools(ctx: AttendanceToolCtx): ToolDef[] {
  const tools = [consultarEstoque(ctx), enviarCatalogo(ctx), escalarHumano(ctx)];
  if (ctx.hasCatalog) tools.push(criarComanda(ctx));
  return tools;
}
