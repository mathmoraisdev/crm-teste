import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import type { OrderPayment, OrderStatus } from "@prisma/client";
import { applyOrderStockExit, reverseOrderStockExit } from "./stock.service";
import { fiscalEmitterFor } from "@/server/fiscal/emitter";
import { decryptSecret } from "@/server/crypto";
import { logger } from "@/lib/logger";
import { pickCommissionRule, commissionForLine } from "@/lib/commission";
import { createLead } from "@/server/services/lead.service";
import { mergeCustomFields } from "@/server/services/custom-field.service";
import { getBranding } from "@/server/services/branding.service";
import type { ReceiptOrderInput } from "@/lib/receipt/model";
import { formatReceiptDateTime } from "@/lib/receipt/model";
import type { KitchenOrderInput } from "@/lib/receipt/kitchen";

export interface OrderItemDTO { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; customFields: Record<string, unknown> | null; }
export interface OrderDTO {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: string; closedAt: string | null;
  customFields: Record<string, unknown> | null;
  // Ajustes financeiros (POS) — entradas do total derivado, expostas p/ a UI.
  discountCents: number | null; surchargeCents: number | null; tipCents: number | null;
  amountTenderedCents: number | null; changeCents: number | null; tableLabel: string | null;
  items: OrderItemDTO[]; subtotalCents: number; totalCents: number;
}

export interface OrderTotalInput {
  items: { unitPriceCents: number; quantity: number }[];
  discountCents?: number | null;
  surchargeCents?: number | null;
  tipCents?: number | null;
}

/** Total DERIVADO: max(0, Σ itens − desconto) + acréscimo/taxa + gorjeta.
 * O desconto nunca deixa o subtotal negativo; acréscimo/gorjeta somam por cima. */
export function orderTotalCents(input: OrderTotalInput): number {
  const subtotal = input.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const discounted = Math.max(0, subtotal - (input.discountCents ?? 0));
  return discounted + (input.surchargeCents ?? 0) + (input.tipCents ?? 0);
}

function asRecord(v: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toDTO(o: {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: Date; closedAt: Date | null;
  customFields?: Prisma.JsonValue | null;
  discountCents?: number | null; surchargeCents?: number | null; tipCents?: number | null;
  amountTenderedCents?: number | null; changeCents?: number | null; tableLabel?: string | null;
  lead?: { name: string } | null;
  items: { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; customFields?: Prisma.JsonValue | null }[];
}): OrderDTO {
  const items = o.items.map((i) => ({ id: i.id, nameSnapshot: i.nameSnapshot, unitPriceCents: i.unitPriceCents, quantity: i.quantity, catalogItemId: i.catalogItemId, customFields: asRecord(i.customFields) }));
  const discountCents = o.discountCents ?? null;
  const surchargeCents = o.surchargeCents ?? null;
  const tipCents = o.tipCents ?? null;
  const subtotalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  return {
    id: o.id, status: o.status, leadId: o.leadId,
    // Nome de exibição: avulsa usa customerName; comanda de lead exibe o nome do
    // lead (a comanda guarda leadId, não duplica o nome — ver openOrder).
    customerName: o.customerName ?? o.lead?.name ?? null,
    payment: o.payment, note: o.note, createdAt: o.createdAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    customFields: asRecord(o.customFields),
    discountCents, surchargeCents, tipCents,
    amountTenderedCents: o.amountTenderedCents ?? null, changeCents: o.changeCents ?? null,
    tableLabel: o.tableLabel ?? null,
    items, subtotalCents,
    totalCents: orderTotalCents({ items, discountCents, surchargeCents, tipCents }),
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

/** Edita a quantidade de um item — só comanda ABERTA. Clampa em >=1 (inteiro). */
export async function setItemQuantity(
  accountId: string,
  orderId: string,
  itemId: string,
  qty: number,
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const owned = order.items.find((i) => i.id === itemId);
  if (!owned) throw new Error("Item não encontrado.");
  if (!Number.isFinite(qty) || qty < 1) throw new Error("Quantidade inválida.");
  const quantity = Math.max(1, Math.floor(qty));
  await prisma.orderItem.update({ where: { id: itemId }, data: { quantity } });
  return toDTO(await loadOwned(accountId, orderId));
}

/** Grava os ajustes financeiros da comanda (só ABERTA). Valores em centavos —
 * a UI resolve % → centavos na borda. `null` limpa o ajuste; `undefined` (chave
 * ausente) não mexe. Rejeita negativos e desconto maior que o subtotal atual. */
export async function setOrderAdjustments(
  accountId: string,
  orderId: string,
  patch: {
    discountCents?: number | null;
    surchargeCents?: number | null;
    tipCents?: number | null;
    tableLabel?: string | null;
  },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");

  const validate = (v: number | null | undefined, label: string): number | null | undefined => {
    if (v === undefined) return undefined; // não mexe
    if (v === null) return null; // limpa
    if (!Number.isInteger(v) || v < 0) throw new Error(`${label} inválido.`);
    return v;
  };
  const discountCents = validate(patch.discountCents, "Desconto");
  const surchargeCents = validate(patch.surchargeCents, "Acréscimo");
  const tipCents = validate(patch.tipCents, "Gorjeta");

  if (typeof discountCents === "number") {
    const subtotal = order.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    if (discountCents > subtotal) throw new Error("Desconto maior que o subtotal.");
  }

  const data: Prisma.OrderUpdateInput = {};
  if (discountCents !== undefined) data.discountCents = discountCents;
  if (surchargeCents !== undefined) data.surchargeCents = surchargeCents;
  if (tipCents !== undefined) data.tipCents = tipCents;
  if (patch.tableLabel !== undefined) data.tableLabel = patch.tableLabel?.trim() || null;

  await prisma.order.update({ where: { id: orderId }, data });
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
  data: {
    tenders?: { method: OrderPayment; amountCents: number }[];
    payment?: OrderPayment; // retrocompat: vira um tender cobrindo o total
    amountTenderedCents?: number; // valor recebido em espécie (base do troco)
    note?: string;
    closedById?: string;
    professionalId?: string; // profissional creditado (comissão); null = deriva do agendamento
    allowPartial?: boolean; // soma < total só fecha com esta flag (dinheiro não trava)
  },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId); // já inclui items
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const closerId = data.closedById ?? order.openedById;

  // Comissão: resolve o profissional creditado. O explícito valida posse AQUI
  // (read-only, fora da tx); a derivação por agendamento roda dentro da tx (junto
  // do fechamento). null = sem crédito (grava professionalId/commissionCents null).
  const explicitPro = data.professionalId ?? null;
  if (explicitPro) {
    const owned = await prisma.professional.findFirst({ where: { id: explicitPro, accountId }, select: { id: true } });
    if (!owned) throw new Error("Profissional não encontrado.");
  }

  // Total derivado COM os ajustes da comanda — é a base do saldo e do troco.
  const total = orderTotalCents({
    items: order.items,
    discountCents: order.discountCents,
    surchargeCents: order.surchargeCents,
    tipCents: order.tipCents,
  });

  // Resolve os meios de pagamento. Retrocompat: o antigo { payment } vira um
  // único tender cobrindo o total.
  const tenders = data.tenders ?? (data.payment ? [{ method: data.payment, amountCents: total }] : []);
  if (tenders.length === 0) throw new Error("Informe ao menos um meio de pagamento.");
  for (const t of tenders) {
    if (!Number.isInteger(t.amountCents) || t.amountCents < 0) throw new Error("Valor de pagamento inválido.");
  }

  const paid = tenders.reduce((s, t) => s + t.amountCents, 0);
  if (paid < total && !data.allowPartial) {
    throw new Error("Pagamento menor que o total. Confirme o fechamento parcial.");
  }

  // Troco só faz sentido com dinheiro. A base é o que é DEVIDO em espécie: o total
  // menos o que já foi pago em outros meios (num misto PIX+dinheiro, o cliente só
  // deve em dinheiro a diferença). Troco = recebido − devido-em-dinheiro, nunca < 0.
  // (No caixa 100% dinheiro, devido-em-dinheiro == total.) Nunca bloqueia.
  const hasCash = tenders.some((t) => t.method === "DINHEIRO");
  const nonCashPaid = tenders.filter((t) => t.method !== "DINHEIRO").reduce((s, t) => s + t.amountCents, 0);
  const cashDue = Math.max(0, total - nonCashPaid);
  const amountTendered = data.amountTenderedCents ?? null;
  const changeCents = hasCash && amountTendered != null ? Math.max(0, amountTendered - cashDue) : 0;

  // Order.payment é mantido espelhado (retrocompat): um único método → ele;
  // misto → OUTRO. A verdade da receita por meio passa a ser OrderTender (Fase 4).
  const distinctMethods = [...new Set(tenders.map((t) => t.method))];
  const payment: OrderPayment = distinctMethods.length === 1 ? distinctMethods[0] : "OUTRO";

  // O nº do cupom (`number`) é sequencial POR conta e é atribuído DENTRO da mesma
  // transação que fecha (junto de closedAt, tenders e da baixa de estoque), p/ nunca
  // haver cupom sem número. O cálculo max+1 pode colidir sob concorrência (dois
  // fechamentos da mesma conta lendo o mesmo max antes de qualquer commit): o
  // @@unique([accountId, number]) barra o 2º com P2002 e a transação inteira rola
  // back — refazemos numa nova tx, onde o max já reflete o 1º. Trade-off: retry
  // raro em vez de serializar todos os fechamentos da conta.
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        // Sessão de caixa: a comanda carimba a sessão ABERTA da conta (se houver);
        // sem sessão, fecha igual com cashSessionId=null ("fora de sessão") — dinheiro
        // nunca é bloqueado ([[caixa-despesas-reposicionamento]]). O lookup fica na tx.
        const openSession = await tx.cashSession.findFirst({
          where: { accountId, status: "ABERTA" },
          select: { id: true },
        });

        // Fiscal (Onda H): carimbo de emissão PENDENTE p/ conta opt-in. O opt-in
        // (User.fiscalEnabled) é a 2ª chave; a emissão real roda no worker (assíncrona
        // — SEFAZ é lento). Conta sem opt-in → fiscalStatus fica null (comanda
        // não-fiscal). Comanda fechada ANTES de ligar o opt-in nunca é emitida
        // retroativamente (só quem nasce com o carimbo). Leitura barata (PK indexada).
        const acct = await tx.user.findUnique({
          where: { id: accountId },
          select: { fiscalEnabled: true },
        });

        // Guarda atômica: o UPDATE condicionado a status=ABERTA é o árbitro. Se dois
        // fechamentos concorrerem (duplo-clique), só um afeta linhas — o outro vê count=0
        // e aborta ANTES da baixa/tenders, evitando decremento/SAIDA/tender em dobro.
        const res = await tx.order.updateMany({
          where: { id: orderId, status: "ABERTA" },
          data: {
            status: "FECHADA", payment, note: data.note?.trim() || null, closedAt: new Date(),
            amountTenderedCents: amountTendered, changeCents,
            cashSessionId: openSession?.id ?? null,
            ...(acct?.fiscalEnabled ? { fiscalStatus: "PENDENTE", fiscalRequestedAt: new Date() } : {}),
          },
        });
        if (res.count === 0) throw new Error("Comanda já fechada.");
        const agg = await tx.order.aggregate({ where: { accountId }, _max: { number: true } });
        const next = (agg._max.number ?? 0) + 1;
        await tx.order.update({ where: { id: orderId }, data: { number: next } });
        await tx.orderTender.createMany({
          data: tenders.map((t) => ({ orderId, method: t.method, amountCents: t.amountCents })),
        });
        await applyOrderStockExit(tx, accountId, order.items, orderId, closerId);

        // ── Snapshot de custo por linha (margem realizada) ─────────────────────
        // Independe da comissão: toda linha com item de catálogo carimba o custo
        // atual (histórico imutável — o custo do catálogo pode mudar depois). Avulso
        // ou item sem custo cadastrado → fica null (conta como parcial no relatório).
        const catIds = [...new Set(order.items.map((i) => i.catalogItemId).filter(Boolean))] as string[];
        if (catIds.length) {
          const costs = await tx.catalogItem.findMany({
            where: { id: { in: catIds }, accountId }, select: { id: true, costCents: true },
          });
          const costById = new Map(costs.map((c) => [c.id, c.costCents]));
          for (const it of order.items) {
            if (!it.catalogItemId) continue;
            const unitCostCents = costById.get(it.catalogItemId) ?? null;
            if (unitCostCents != null) await tx.orderItem.update({ where: { id: it.id }, data: { unitCostCents } });
          }
        }

        // ── Comissão: snapshot por linha ──────────────────────────────────────
        // Credita UM profissional por comanda: o explícito do fechamento OU, na
        // falta, o único do agendamento ligado (0 ou >1 distinto = ambíguo → sem
        // crédito). Cada linha calcula pela SUA regra (específica > padrão). Sem
        // profissional resolvido, os campos ficam null (comanda sem comissão).
        let creditedProId = explicitPro;
        if (!creditedProId) {
          const appts = await tx.appointment.findMany({
            where: { orderId, professionalId: { not: null } },
            select: { professionalId: true },
          });
          const distinct = [...new Set(appts.map((a) => a.professionalId))];
          creditedProId = distinct.length === 1 ? distinct[0] : null;
        }
        if (creditedProId) {
          const rules = await tx.commissionRule.findMany({
            where: { accountId, professionalId: creditedProId, active: true },
            select: { catalogItemId: true, percentBps: true, fixedCents: true },
          });
          for (const it of order.items) {
            const rule = pickCommissionRule(rules, it.catalogItemId);
            const commissionCents = commissionForLine({
              unitPriceCents: it.unitPriceCents, quantity: it.quantity, rule,
            });
            await tx.orderItem.update({
              where: { id: it.id },
              data: { professionalId: creditedProId, commissionCents },
            });
          }
        }
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

/**
 * Estorno: anula uma comanda FECHADA (vira CANCELADA), reverte a baixa de estoque e
 * grava a auditoria (motivo obrigatório + quem/quando). Transacional; a guarda atômica
 * `updateMany where status=FECHADA` garante UMA reversão só (barra duplo estorno/corrida).
 * O ledger nunca apaga — reverseOrderStockExit compensa com ENTRADA.
 */
export async function voidOrder(accountId: string, orderId: string, reason: string, byId: string): Promise<OrderDTO> {
  const trimmed = reason?.trim();
  if (!trimmed) throw new Error("Informe o motivo do estorno.");
  const order = await loadOwned(accountId, orderId); // valida escopo por conta (throw se não achar)
  if (order.status !== "FECHADA") throw new Error("Só é possível estornar uma comanda fechada.");

  await prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: orderId, accountId, status: "FECHADA" },
      data: { status: "CANCELADA", canceledAt: new Date(), canceledReason: trimmed, canceledById: byId },
    });
    if (res.count === 0) throw new Error("Comanda já estornada.");
    // NÃO limpa o snapshot de comissão: o relatório filtra status=FECHADA, então a
    // comanda CANCELADA some sozinha; o snapshot fica no item p/ auditoria (inofensivo).
    await reverseOrderStockExit(tx, accountId, orderId, byId);
  });

  // Fiscal (Onda H): se a comanda tinha nota EMITIDA, tenta cancelá-la no emissor —
  // best-effort SÍNCRONO, FORA da tx (o estorno já commitou). A janela legal é curta
  // (~30 min NFC-e); se passou, a nota fica EMITIDA com aviso e o contador resolve.
  // Falha aqui NUNCA desfaz o estorno. Nunca loga o token.
  const fiscal = await prisma.order.findUnique({
    where: { id: orderId },
    select: { fiscalStatus: true, fiscalDocId: true },
  });
  if (fiscal?.fiscalStatus === "EMITIDA" && fiscal.fiscalDocId) {
    try {
      const acct = await prisma.user.findUnique({
        where: { id: accountId },
        select: { fiscalProvider: true, fiscalKeyEnc: true, fiscalEnv: true },
      });
      if (acct?.fiscalProvider && acct.fiscalKeyEnc) {
        const r = await fiscalEmitterFor(acct.fiscalProvider).cancelNfce(
          decryptSecret(acct.fiscalKeyEnc), acct.fiscalEnv, fiscal.fiscalDocId, trimmed,
        );
        // cancelNfce sinaliza sucesso reusando status "EMITIDA" (janela ok) → CANCELADA;
        // qualquer outra coisa (janela passou/erro) mantém EMITIDA com o motivo.
        await prisma.order.update({
          where: { id: orderId },
          data: {
            fiscalStatus: r.status === "EMITIDA" ? "CANCELADA" : "EMITIDA",
            fiscalError: r.status === "EMITIDA" ? null : (r.error ?? "Não foi possível cancelar a NFC-e (janela?)."),
          },
        });
      }
    } catch (err) {
      logger.error({ orderId, err }, "[fiscal] cancelamento no estorno falhou (janela?)");
    }
  }
  return toDTO(await loadOwned(accountId, orderId));
}

/**
 * Reabertura: volta uma comanda FECHADA para ABERTA p/ correção. Limpa o fechamento
 * (closedAt/payment/number/tenders/troco/sessão) e reverte a baixa de estoque — será
 * re-baixada no próximo fechamento. Deixa BURACO na sequência de `number` (o cupom já
 * foi impresso; reabrir é reedição de exceção — documentado no plano). Transacional +
 * guarda atômica em status=FECHADA.
 */
export async function reopenOrder(accountId: string, orderId: string, byId: string): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId); // valida escopo por conta
  if (order.status !== "FECHADA") throw new Error("Só é possível reabrir uma comanda fechada.");

  await prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: orderId, accountId, status: "FECHADA" },
      data: {
        status: "ABERTA", closedAt: null, payment: null, number: null,
        amountTenderedCents: null, changeCents: null, cashSessionId: null,
      },
    });
    if (res.count === 0) throw new Error("Comanda não pôde ser reaberta.");
    // Fiscal (Onda H): descarta o carimbo SÓ se ainda não virou nota (PENDENTE/ERRO).
    // Uma nota já EMITIDA/PROCESSANDO NÃO pode sumir silenciosamente — o descarte
    // fiscal é via estorno/cancelamento (13.3.3), nunca pela reabertura.
    await tx.order.updateMany({
      where: { id: orderId, accountId, fiscalStatus: { in: ["PENDENTE", "ERRO"] } },
      data: { fiscalStatus: null, fiscalRequestedAt: null, fiscalError: null, fiscalAttempts: 0 },
    });
    await tx.orderTender.deleteMany({ where: { orderId } });
    // Limpa o snapshot de comissão — será recalculado no próximo fechamento (a
    // regra/preço/agendamento podem ter mudado). Sem isso o snapshot fica velho.
    await tx.orderItem.updateMany({ where: { orderId }, data: { professionalId: null, commissionCents: null, unitCostCents: null } });
    await reverseOrderStockExit(tx, accountId, orderId, byId);
  });
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
  const tenders = await prisma.orderTender.findMany({
    where: { orderId },
    select: { method: true, amountCents: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    order: {
      number: o.number,
      id: o.id,
      // mesmo nome de exibição do DTO: avulsa usa customerName; de lead usa o nome do lead
      customerName: o.customerName ?? o.lead?.name ?? null,
      closedAt: o.closedAt,
      payment: o.payment,
      discountCents: o.discountCents,
      surchargeCents: o.surchargeCents,
      tipCents: o.tipCents,
      changeCents: o.changeCents,
      tenders: tenders.map((t) => ({ method: t.method, amountCents: t.amountCents })),
      items: o.items.map((i) => ({
        nameSnapshot: i.nameSnapshot,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
      })),
    },
    business: { name: branding.appName, subtitle: null },
  };
}

/** Extrai uma observação livre dos customFields do item (chaves comuns), se houver. */
function extractItemNote(customFields: Prisma.JsonValue | null | undefined): string | null {
  const rec = asRecord(customFields);
  if (!rec) return null;
  for (const k of ["obs", "observacao", "observação", "nota", "note"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Dados p/ a comanda de cozinha (N3): itens anotados com o setor do catálogo,
 * escopado por conta. O setor vem de CatalogItem.printSector (null p/ linha avulsa
 * ou item sem setor). Retorna no formato que `buildKitchenTickets` espera. */
export async function getKitchenOrder(accountId: string, orderId: string): Promise<KitchenOrderInput> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, accountId },
    include: {
      items: { orderBy: { createdAt: "asc" }, include: { catalogItem: { select: { printSector: true } } } },
      lead: { select: { name: true } },
    },
  });
  if (!o) throw new Error("Comanda não encontrada.");
  const docNumber = o.number != null ? `Comanda #${o.number}` : `Comanda ${o.id}`.slice(0, 20);
  return {
    docNumber,
    customerName: o.customerName ?? o.lead?.name ?? null,
    dateTime: formatReceiptDateTime(o.createdAt),
    note: o.note,
    items: o.items.map((i) => ({
      name: i.nameSnapshot,
      quantity: i.quantity,
      sector: i.catalogItem?.printSector ?? null,
      note: extractItemNote(i.customFields),
    })),
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
