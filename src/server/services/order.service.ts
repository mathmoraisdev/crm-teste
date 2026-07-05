import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import type { OrderPayment, OrderStatus } from "@prisma/client";
import { applyOrderStockExit } from "./stock.service";
import { createLead } from "@/server/services/lead.service";
import { mergeCustomFields } from "@/server/services/custom-field.service";
import { getBranding } from "@/server/services/branding.service";
import type { ReceiptOrderInput } from "@/lib/receipt/model";

export interface OrderItemDTO { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; customFields: Record<string, unknown> | null; }
export interface OrderDTO {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: string; closedAt: string | null;
  customFields: Record<string, unknown> | null;
  items: OrderItemDTO[]; totalCents: number;
}

/** Soma pura — total derivado dos itens. */
export function orderTotalCents(items: { unitPriceCents: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

function asRecord(v: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toDTO(o: {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: Date; closedAt: Date | null;
  customFields?: Prisma.JsonValue | null;
  lead?: { name: string } | null;
  items: { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; customFields?: Prisma.JsonValue | null }[];
}): OrderDTO {
  const items = o.items.map((i) => ({ id: i.id, nameSnapshot: i.nameSnapshot, unitPriceCents: i.unitPriceCents, quantity: i.quantity, catalogItemId: i.catalogItemId, customFields: asRecord(i.customFields) }));
  return {
    id: o.id, status: o.status, leadId: o.leadId,
    // Nome de exibição: avulsa usa customerName; comanda de lead exibe o nome do
    // lead (a comanda guarda leadId, não duplica o nome — ver openOrder).
    customerName: o.customerName ?? o.lead?.name ?? null,
    payment: o.payment, note: o.note, createdAt: o.createdAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    customFields: asRecord(o.customFields), items, totalCents: orderTotalCents(items),
  };
}

async function loadOwned(accountId: string, id: string) {
  const o = await prisma.order.findFirst({
    where: { id, accountId },
    include: { items: { orderBy: { createdAt: "asc" } }, lead: { select: { name: true } } },
  });
  if (!o) throw new Error("Comanda não encontrada.");
  return o;
}

export async function openOrder(
  accountId: string,
  data: {
    openedById: string;
    leadId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null; // NOVO: se vier, cria/vincula lead por telefone
  },
): Promise<OrderDTO> {
  let leadId = data.leadId ?? null;

  // Captura de lead: telefone informado numa comanda avulsa → cria/vincula lead
  // (dedup por telefone dentro de createLead) e passa a tratar como comanda de lead.
  if (!leadId && data.customerPhone?.trim()) {
    const lead = await createLead(
      accountId,
      data.customerName?.trim() || "Sem nome",
      data.customerPhone.trim(),
    );
    leadId = lead.id;
  }

  const o = await prisma.order.create({
    data: {
      accountId, openedById: data.openedById,
      leadId,
      customerName: leadId ? null : (data.customerName?.trim() || "Sem nome"),
    },
    include: { items: true, lead: { select: { name: true } } },
  });
  return toDTO(o);
}

export async function addItem(
  accountId: string,
  orderId: string,
  data: { catalogItemId?: string; name?: string; unitPriceCents?: number; quantity?: number; customFields?: Record<string, unknown> },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const qty = Math.max(1, Math.floor(data.quantity ?? 1));

  let nameSnapshot: string;
  let unitPriceCents: number;
  let catalogItemId: string | null = null;

  if (data.catalogItemId) {
    const ci = await prisma.catalogItem.findFirst({ where: { id: data.catalogItemId, accountId } });
    if (!ci) throw new Error("Item do catálogo não encontrado.");
    nameSnapshot = ci.name; unitPriceCents = ci.priceCents; catalogItemId = ci.id;
  } else {
    if (!data.name?.trim()) throw new Error("Informe o item.");
    if (!Number.isInteger(data.unitPriceCents) || (data.unitPriceCents ?? -1) < 0) throw new Error("Preço inválido.");
    nameSnapshot = data.name.trim(); unitPriceCents = data.unitPriceCents!;
  }

  const customFields = data.customFields
    ? await mergeCustomFields(accountId, null, data.customFields, "ORDER_ITEM")
    : undefined;

  await prisma.orderItem.create({
    data: {
      orderId, catalogItemId, nameSnapshot, unitPriceCents, quantity: qty,
      ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
    },
  });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function removeItem(accountId: string, orderId: string, itemId: string): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const owned = order.items.find((i) => i.id === itemId);
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.orderItem.delete({ where: { id: itemId } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function closeOrder(
  accountId: string,
  orderId: string,
  data: { payment: OrderPayment; note?: string; closedById?: string },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId); // já inclui items
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const closerId = data.closedById ?? order.openedById;
  // O nº do cupom (`number`) é sequencial POR conta e é atribuído DENTRO da mesma
  // transação que fecha (junto de closedAt e da baixa de estoque), p/ nunca haver
  // cupom sem número. O cálculo max+1 pode colidir sob concorrência (dois
  // fechamentos da mesma conta lendo o mesmo max antes de qualquer commit): o
  // @@unique([accountId, number]) barra o 2º com P2002 e a transação inteira rola
  // back — refazemos numa nova tx, onde o max já reflete o 1º. Trade-off: retry
  // raro em vez de serializar todos os fechamentos da conta.
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        // Guarda atômica: o UPDATE condicionado a status=ABERTA é o árbitro. Se dois
        // fechamentos concorrerem (duplo-clique), só um afeta linhas — o outro vê count=0
        // e aborta ANTES da baixa, evitando decremento/​SAIDA em dobro.
        const res = await tx.order.updateMany({
          where: { id: orderId, status: "ABERTA" },
          data: { status: "FECHADA", payment: data.payment, note: data.note?.trim() || null, closedAt: new Date() },
        });
        if (res.count === 0) throw new Error("Comanda já fechada.");
        const agg = await tx.order.aggregate({ where: { accountId }, _max: { number: true } });
        const next = (agg._max.number ?? 0) + 1;
        await tx.order.update({ where: { id: orderId }, data: { number: next } });
        await applyOrderStockExit(tx, accountId, order.items, orderId, closerId);
      });
      break;
    } catch (e) {
      // Só a colisão de `number` (P2002) é retentável; o resto (ex.: "já fechada") propaga.
      if (attempt < 4 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue;
      }
      throw e;
    }
  }
  return toDTO(await loadOwned(accountId, orderId));
}

export async function listOpenOrders(accountId: string): Promise<OrderDTO[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "ABERTA" },
    include: { items: { orderBy: { createdAt: "asc" } }, lead: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return orders.map(toDTO);
}

export async function getOrder(accountId: string, id: string): Promise<OrderDTO> {
  return toDTO(await loadOwned(accountId, id));
}

/** Dados p/ o recibo/cupom: comanda (escopada por conta) + empresa. Faz o I/O e
 * devolve no formato que `buildReceiptModel` espera — sem chamar o model aqui
 * (separação I/O × pura). Lança se a comanda não é da conta. */
export interface ReceiptData {
  order: ReceiptOrderInput;
  business: { name: string; subtitle: string | null };
}
export async function getReceiptData(accountId: string, orderId: string): Promise<ReceiptData> {
  const o = await loadOwned(accountId, orderId); // já valida escopo por conta (throw se não achar)
  const branding = await getBranding(accountId);
  return {
    order: {
      number: o.number,
      id: o.id,
      // mesmo nome de exibição do DTO: avulsa usa customerName; de lead usa o nome do lead
      customerName: o.customerName ?? o.lead?.name ?? null,
      closedAt: o.closedAt,
      payment: o.payment,
      items: o.items.map((i) => ({
        nameSnapshot: i.nameSnapshot,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
      })),
    },
    business: { name: branding.appName, subtitle: null },
  };
}

/** Grava/valida os customFields (scope=ORDER) da comanda. Só comanda ABERTA. */
export async function setOrderCustomFields(
  accountId: string,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const merged = await mergeCustomFields(accountId, order.customFields, patch, "ORDER");
  await prisma.order.update({ where: { id: orderId }, data: { customFields: merged as Prisma.InputJsonValue } });
  return toDTO(await loadOwned(accountId, orderId));
}

/** Grava/valida os customFields (scope=ORDER_ITEM) de um item. Só comanda ABERTA. */
export async function setOrderItemCustomFields(
  accountId: string,
  orderId: string,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item não encontrado.");
  const merged = await mergeCustomFields(accountId, item.customFields, patch, "ORDER_ITEM");
  await prisma.orderItem.update({ where: { id: itemId }, data: { customFields: merged as Prisma.InputJsonValue } });
  return toDTO(await loadOwned(accountId, orderId));
}
