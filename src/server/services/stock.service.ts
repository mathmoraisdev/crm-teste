import { prisma } from "@/server/db/client";
import type { Prisma, StockMovementKind } from "@prisma/client";

export interface StockItemDTO {
  id: string; name: string; sku: string | null;
  stockQty: number; minStock: number; costCents: number | null; low: boolean;
}
export interface StockMovementDTO {
  id: string; kind: StockMovementKind; delta: number; balanceAfter: number;
  reason: string | null; orderId: string | null; createdAt: string;
}

function itemToDTO(o: { id: string; name: string; sku: string | null; stockQty: number; minStock: number; costCents: number | null }): StockItemDTO {
  return { id: o.id, name: o.name, sku: o.sku, stockQty: o.stockQty, minStock: o.minStock, costCents: o.costCents, low: o.stockQty <= o.minStock };
}

/** Produtos com controle de estoque ligado, por nome. */
export async function listStock(accountId: string): Promise<StockItemDTO[]> {
  const items = await prisma.catalogItem.findMany({
    where: { accountId, trackStock: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, sku: true, stockQty: true, minStock: true, costCents: true },
  });
  return items.map(itemToDTO);
}

/** Só os que estão no/abaixo do mínimo (alerta). */
export async function lowStockItems(accountId: string): Promise<StockItemDTO[]> {
  return (await listStock(accountId)).filter((i) => i.low);
}

export async function listMovements(accountId: string, catalogItemId: string, limit = 50): Promise<StockMovementDTO[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { accountId, catalogItemId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((m) => ({
    id: m.id, kind: m.kind, delta: m.delta, balanceAfter: m.balanceAfter,
    reason: m.reason, orderId: m.orderId, createdAt: m.createdAt.toISOString(),
  }));
}

async function assertTracked(tx: Prisma.TransactionClient, accountId: string, catalogItemId: string) {
  const ci = await tx.catalogItem.findFirst({ where: { id: catalogItemId, accountId, trackStock: true }, select: { id: true, stockQty: true } });
  if (!ci) throw new Error("Produto não encontrado ou sem controle de estoque.");
  return ci;
}

/** Entrada de estoque (+qty). increment atômico + movimento no mesmo tx. */
export async function recordEntry(
  accountId: string, catalogItemId: string,
  data: { qty: number; unitCostCents?: number | null; reason?: string; createdById: string },
): Promise<number> {
  if (!Number.isInteger(data.qty) || data.qty <= 0) throw new Error("Quantidade inválida.");
  return prisma.$transaction(async (tx) => {
    const ci = await assertTracked(tx, accountId, catalogItemId);
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: { increment: data.qty } }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "ENTRADA", delta: data.qty, balanceAfter: updated.stockQty,
      reason: data.reason?.trim() || null, unitCostCents: data.unitCostCents ?? null, createdById: data.createdById,
    } });
    return updated.stockQty;
  });
}

/** Ajuste/inventário: define o saldo para `newQty`, gravando o delta. */
export async function recordAdjustment(
  accountId: string, catalogItemId: string,
  data: { newQty: number; reason?: string; createdById: string },
): Promise<number> {
  if (!Number.isInteger(data.newQty) || data.newQty < 0) throw new Error("Quantidade inválida.");
  return prisma.$transaction(async (tx) => {
    const ci = await assertTracked(tx, accountId, catalogItemId);
    const delta = data.newQty - ci.stockQty;
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: data.newQty }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "AJUSTE", delta, balanceAfter: updated.stockQty,
      reason: data.reason?.trim() || null, createdById: data.createdById,
    } });
    return updated.stockQty;
  });
}

/**
 * Baixa de venda ao fechar a comanda. Chamado DENTRO da transação de closeOrder.
 * Para cada linha ligada a um produto rastreado da conta: decrementa (atômico) e
 * grava SAIDA. Ignora linhas avulsas e itens sem trackStock. NÃO bloqueia se faltar
 * estoque (permite negativo — nunca travar a venda).
 */
export async function applyOrderStockExit(
  tx: Prisma.TransactionClient,
  accountId: string,
  items: { catalogItemId: string | null; quantity: number }[],
  orderId: string,
  createdById: string,
): Promise<void> {
  for (const it of items) {
    if (!it.catalogItemId) continue;
    const ci = await tx.catalogItem.findFirst({ where: { id: it.catalogItemId, accountId, trackStock: true }, select: { id: true } });
    if (!ci) continue;
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: { decrement: it.quantity } }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "SAIDA", delta: -it.quantity, balanceAfter: updated.stockQty, orderId, createdById,
    } });
  }
}

/**
 * Reverte a baixa de estoque de uma comanda (estorno/reabertura). Chamado DENTRO da
 * transação de voidOrder/reopenOrder. Para cada produto rastreado, olha o SALDO LÍQUIDO
 * dos movimentos ligados à comanda: se ainda está baixado (líquido < 0), cria um ENTRADA
 * de compensação (delta positivo, mesmo orderId, reason "estorno de comanda") e incrementa
 * o stockQty. Ledger append-only: nunca apaga a SAIDA, compensa. Idempotente: depois de
 * reverter o líquido é 0, então uma segunda chamada não cria nada (guarda contra duplo estorno).
 */
export async function reverseOrderStockExit(
  tx: Prisma.TransactionClient,
  accountId: string,
  orderId: string,
  createdById: string,
): Promise<void> {
  const moves = await tx.stockMovement.findMany({
    where: { accountId, orderId },
    select: { catalogItemId: true, delta: true },
  });
  const net = new Map<string, number>();
  for (const m of moves) net.set(m.catalogItemId, (net.get(m.catalogItemId) ?? 0) + m.delta);
  for (const [catalogItemId, sum] of net) {
    if (sum >= 0) continue; // nada baixado, ou já compensado (idempotência)
    const qty = -sum;
    const ci = await tx.catalogItem.findFirst({ where: { id: catalogItemId, accountId, trackStock: true }, select: { id: true } });
    if (!ci) continue; // produto deixou de rastrear estoque: não mexe no saldo
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: { increment: qty } }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "ENTRADA", delta: qty, balanceAfter: updated.stockQty,
      orderId, reason: "estorno de comanda", createdById,
    } });
  }
}
