import { randomUUID } from "node:crypto";
import type { PaymentProvider } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { resolvePaymentForUser } from "@/server/payments/resolve";
import { gatewayFor } from "@/server/payments/gateway";
import { isAccountActive } from "@/server/services/account.service";
import { sendWhatsAppMessage } from "./messaging";
import { notifyMerchantNewOnlineOrder } from "./fulfillment-notify.service";
import { formatCentsBRL } from "@/lib/money";

/** Lead mínimo p/ enviar a cobrança (mesmos campos que `sendWhatsAppMessage` usa). */
export interface SaleLead {
  id: string;
  phone: string;
  userId: string;
  name?: string | null;
  whatsAppNumberId?: string | null;
}

export type SendOfferResult =
  | { sent: true; saleId: string }
  | { sent: false; reason: "no_gateway" | "offer_invalid" | "suspended" | "charge_failed" };

/**
 * Envia uma oferta como cobrança Pix ao lead. O preço vem SEMPRE de
 * `Offer.priceCents` (banco) — a IA nunca informa valor. Fluxo:
 *  1. resolve a credencial de pagamento do dono (null = vendas off);
 *  2. valida a oferta (ativa + do dono) e faz snapshot do preço;
 *  3. respeita o gate de billing (conta suspensa não cobra);
 *  4. cria a Sale, gera a cobrança no gateway do cliente, envia o copia-e-cola
 *     e move o lead p/ OFERTA_ENVIADA.
 */
export async function sendOffer(lead: SaleLead, offerId: string): Promise<SendOfferResult> {
  const credential = await resolvePaymentForUser(lead.userId);
  if (!credential) {
    console.warn(`[sales] sendOffer sem gateway configurado (user=${lead.userId})`);
    return { sent: false, reason: "no_gateway" };
  }

  // Oferta precisa ser ATIVA e do dono. O preço é a fonte de verdade (snapshot).
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, userId: lead.userId, active: true },
    select: { id: true, name: true, description: true, priceCents: true },
  });
  if (!offer) return { sent: false, reason: "offer_invalid" };

  // Gate de billing: conta suspensa (inadimplência) não gera cobrança.
  if (!(await isAccountActive(lead.userId))) {
    return { sent: false, reason: "suspended" };
  }

  const gateway = gatewayFor(credential.provider);

  // A Sale nasce com um providerChargeId provisório (único) só p/ satisfazer a
  // constraint; o `externalReference` da cobrança é o próprio Sale.id, e o id real
  // do gateway substitui o provisório logo abaixo.
  const sale = await prisma.sale.create({
    data: {
      userId: lead.userId,
      leadId: lead.id,
      offerId: offer.id,
      provider: credential.provider,
      providerChargeId: `pending:${randomUUID()}`,
      amountCents: offer.priceCents,
      status: "PENDING",
    },
  });

  let charge;
  try {
    charge = await gateway.createPixCharge({
      apiKey: credential.apiKey,
      amountCents: offer.priceCents,
      description: offer.name,
      externalReference: sale.id,
      payerName: lead.name ?? undefined,
    });
  } catch (e) {
    // Cobrança falhou: descarta a Sale provisória (não deixa lixo PENDING órfão).
    try {
      await prisma.sale.delete({ where: { id: sale.id } });
    } catch {
      /* best-effort: se a limpeza falhar, a Sale fica PENDING (sem Pix) */
    }
    console.error(`[sales] createPixCharge falhou (sale=${sale.id}):`, e);
    return { sent: false, reason: "charge_failed" };
  }

  await prisma.sale.update({
    where: { id: sale.id },
    data: { providerChargeId: charge.providerChargeId, pixCopiaECola: charge.pixCopiaECola },
  });

  const body = buildOfferMessage(offer.name, offer.priceCents, charge.pixCopiaECola);
  await sendWhatsAppMessage(lead, body);

  await prisma.lead.update({ where: { id: lead.id }, data: { status: "OFERTA_ENVIADA" } });

  return { sent: true, saleId: sale.id };
}

export type ConfirmResult =
  | { confirmed: true; alreadyPaid?: boolean }
  | { confirmed: false; reason: "not_found" | "no_gateway" | "not_paid" };

/**
 * Confirma o pagamento de uma cobrança a partir de um ping de webhook. Idempotente
 * (o webhook repete) e SEGURO: não confia no corpo do webhook — re-consulta o
 * status na API do gateway com o token do dono (fonte de verdade). Só então marca
 * a Sale como PAID, move o lead p/ PAGO e envia a mensagem pós-venda.
 */
export async function confirmPaymentByCharge(
  provider: PaymentProvider,
  providerChargeId: string,
): Promise<ConfirmResult> {
  const sale = await prisma.sale.findUnique({
    where: { provider_providerChargeId: { provider, providerChargeId } },
    select: { id: true, userId: true, leadId: true, status: true, amountCents: true, offer: { select: { name: true } } },
  });
  if (!sale) {
    // Fallback: pedido online do cardápio (a cobrança mora no Order, não no Sale).
    return confirmOnlineOrderCharge(provider, providerChargeId);
  }

  // Idempotência: já confirmada → não reprocessa (webhook repetido).
  if (sale.status === "PAID") return { confirmed: true, alreadyPaid: true };

  // Reconsulta na API do gateway (fonte de verdade) com o token do dono.
  const credential = await resolvePaymentForUser(sale.userId);
  if (!credential || credential.provider !== provider) {
    return { confirmed: false, reason: "no_gateway" };
  }
  const paid = await gatewayFor(provider).isChargePaid(credential.apiKey, providerChargeId);
  if (!paid) return { confirmed: false, reason: "not_paid" };

  await prisma.$transaction([
    prisma.sale.update({
      where: { id: sale.id },
      data: { status: "PAID", paidAt: new Date() },
    }),
    prisma.lead.update({ where: { id: sale.leadId }, data: { status: "PAGO" } }),
  ]);

  // Mensagem pós-venda ao lead. Carrega os dados de envio do lead.
  const lead = await prisma.lead.findUnique({
    where: { id: sale.leadId },
    select: { id: true, phone: true, userId: true, whatsAppNumberId: true },
  });
  if (lead) {
    await sendWhatsAppMessage(lead, buildPaidMessage(sale.offer?.name ?? null), { source: "SYSTEM" });
  }

  return { confirmed: true };
}

/**
 * Fallback do webhook p/ pedido online do cardápio: a cobrança mora no `Order`
 * (onlineChargeProvider/onlineChargeId), não no `Sale`. Idempotente (webhook
 * repete) e seguro: re-consulta o gateway (fonte de verdade) antes de marcar
 * `onlinePaidAt`. A notificação ao lojista (fila de pedidos) sai na Fase 8.
 */
async function confirmOnlineOrderCharge(
  provider: PaymentProvider,
  providerChargeId: string,
): Promise<ConfirmResult> {
  const order = await prisma.order.findFirst({
    where: { onlineChargeProvider: provider, onlineChargeId: providerChargeId },
    select: { id: true, accountId: true, onlinePaidAt: true },
  });
  if (!order) return { confirmed: false, reason: "not_found" };

  // Idempotente: já confirmado → não reprocessa.
  if (order.onlinePaidAt) return { confirmed: true, alreadyPaid: true };

  const resolved = await resolvePaymentForUser(order.accountId);
  if (!resolved || resolved.provider !== provider) {
    return { confirmed: false, reason: "no_gateway" };
  }
  const paid = await gatewayFor(provider).isChargePaid(resolved.apiKey, providerChargeId);
  if (!paid) return { confirmed: false, reason: "not_paid" };

  await prisma.order.update({
    where: { id: order.id },
    data: { onlinePaidAt: new Date() },
  });
  // Avisa o lojista que entrou um pedido pago-online (best-effort, não bloqueia).
  await notifyMerchantNewOnlineOrder(order.accountId, order.id).catch(() => {});
  return { confirmed: true };
}

/** Texto da oferta + Pix copia-e-cola (WhatsApp, sem markdown). */
function buildOfferMessage(name: string, priceCents: number, pixCopiaECola: string): string {
  return (
    `Perfeito! Para garantir *${name}* (${formatCentsBRL(priceCents)}), é só pagar via Pix.\n\n` +
    `Copia e cola:\n${pixCopiaECola}\n\n` +
    `Assim que o pagamento cair, te confirmo por aqui. 🙌`
  );
}

/** Mensagem pós-venda enviada quando o pagamento é confirmado. */
function buildPaidMessage(offerName: string | null): string {
  const what = offerName ? ` de *${offerName}*` : "";
  return `Pagamento confirmado! ✅ Recebemos o seu Pix${what}. Obrigado pela confiança — já vou dar sequência por aqui.`;
}
