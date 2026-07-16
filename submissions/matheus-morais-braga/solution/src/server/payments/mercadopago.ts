import { env } from "@/lib/env";
import type {
  CreatePixChargeInput,
  PaymentGateway,
  PixCharge,
} from "./gateway";

/**
 * Gateway Mercado Pago (Pix). Auth por header `Authorization: Bearer <token>`.
 * Base via env.MERCADOPAGO_BASE_URL. A resposta do POST já traz o copia-e-cola
 * em point_of_interaction.transaction_data.
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
 */
function base(): string {
  return env.MERCADOPAGO_BASE_URL.replace(/\/+$/, "");
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function notificationUrl(): string {
  return `${env.APP_PUBLIC_URL.replace(/\/+$/, "")}/api/webhooks/payment/mercadopago`;
}

interface MpPaymentResponse {
  id: number | string;
  status?: string;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string };
  };
}

export const mercadoPagoGateway: PaymentGateway = {
  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const res = await fetch(`${base()}/v1/payments`, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100, // MP usa reais (decimal)
        description: input.description,
        payment_method_id: "pix",
        external_reference: input.externalReference,
        notification_url: notificationUrl(),
      }),
    });
    if (!res.ok) {
      throw new Error(`Mercado Pago: falha ao criar cobrança (${res.status})`);
    }
    const payment = (await res.json()) as MpPaymentResponse;
    const tx = payment.point_of_interaction?.transaction_data;

    return {
      providerChargeId: String(payment.id),
      pixCopiaECola: tx?.qr_code ?? "",
      pixQrCodeBase64: tx?.qr_code_base64,
    };
  },

  async isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean> {
    const res = await fetch(`${base()}/v1/payments/${providerChargeId}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) return false;
    const payment = (await res.json()) as MpPaymentResponse;
    return payment.status === "approved";
  },

  async verifyCredential(apiKey: string): Promise<boolean> {
    const res = await fetch(`${base()}/v1/payment_methods`, {
      method: "GET",
      headers: headers(apiKey),
    });
    return res.ok;
  },

  parseWebhookChargeId(body: unknown): string | null {
    const b = body as { data?: { id?: string | number } } | null;
    const id = b?.data?.id;
    return id != null ? String(id) : null;
  },
};
