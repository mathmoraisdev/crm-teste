import { prisma } from "@/server/db/client";
import { resolvePaymentForUser } from "@/server/payments/resolve";
import { gatewayFor } from "@/server/payments/gateway";

/**
 * Cria uma cobrança Pix direto na Order do cardápio online (sem Sale — a cobrança
 * mora no próprio Order; o webhook reconcilia por `onlineChargeProvider/Id`).
 * `externalReference = order:<id>` para o fallback do webhook casar.
 */
export async function createOnlinePixCharge(
  accountId: string,
  orderId: string,
  amountCents: number,
  payerName: string,
): Promise<{ copiaECola: string; qrBase64?: string }> {
  const resolved = await resolvePaymentForUser(accountId);
  if (!resolved) throw new Error("PAY_OFF:Conta sem gateway de pagamento configurado.");
  const charge = await gatewayFor(resolved.provider).createPixCharge({
    apiKey: resolved.apiKey,
    amountCents,
    description: `Pedido ${orderId.slice(0, 8)}`,
    externalReference: `order:${orderId}`,
    payerName,
  });
  await prisma.order.update({
    where: { id: orderId },
    data: {
      onlineChargeProvider: resolved.provider,
      onlineChargeId: charge.providerChargeId,
      onlinePixCopiaECola: charge.pixCopiaECola,
    },
  });
  return { copiaECola: charge.pixCopiaECola, qrBase64: charge.pixQrCodeBase64 };
}
