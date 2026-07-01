import { NextResponse } from "next/server";
import type { PaymentProvider } from "@prisma/client";
import { gatewayFor } from "@/server/payments/gateway";
import { confirmPaymentByCharge } from "@/server/services/sales.service";

export const dynamic = "force-dynamic";

/**
 * Webhook de pagamento (por provider). É apenas um "ping": NÃO confiamos no corpo
 * para marcar como pago. Extraímos o id da cobrança e chamamos
 * `confirmPaymentByCharge`, que re-consulta o status na API do gateway (fonte de
 * verdade) com o token do dono. Idempotente (o gateway repete o webhook).
 *
 * Responde SEMPRE 200: um erro nosso não deve fazer o gateway re-tentar em loop —
 * a próxima notificação (ou a reconciliação) resolve. Corpo inválido = no-op.
 *
 * Segurança (follow-up): validar assinatura (MP `x-signature`, token Asaas). Hoje
 * a defesa está na reconsulta via API, que ignora qualquer corpo forjado.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await params;
  const provider: PaymentProvider = raw.toUpperCase() === "ASAAS" ? "ASAAS" : "MERCADO_PAGO";

  const body = await req.json().catch(() => null);
  const chargeId = gatewayFor(provider).parseWebhookChargeId(body);
  if (chargeId) {
    try {
      await confirmPaymentByCharge(provider, chargeId); // reconsulta na API lá dentro
    } catch (e) {
      // Nunca vaza erro ao gateway (evita retry em loop por falha nossa).
      console.error(`[webhook:${provider}] confirmPaymentByCharge falhou (charge=${chargeId}):`, e);
    }
  }
  return NextResponse.json({ ok: true });
}
