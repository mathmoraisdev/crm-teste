import { env } from "@/lib/env";
import type {
  CreatePixChargeInput,
  PaymentGateway,
  PixCharge,
} from "./gateway";

/**
 * Gateway PagBank (PagSeguro) — Pix via Orders API. Auth por header
 * `Authorization: Bearer <token>`. Base sandbox/prod via env.PAGBANK_BASE_URL.
 * ATENÇÃO: o PagBank usa o valor em CENTAVOS (inteiro), diferente de MP/Asaas
 * (reais decimal). Guardamos o id do PEDIDO (ORDE_...) como providerChargeId —
 * a charge Pix só nasce quando pago; o webhook e a reconsulta batem pelo pedido.
 *
 * Docs: https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code
 */
function base(): string {
  return env.PAGBANK_BASE_URL.replace(/\/+$/, "");
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function notificationUrl(): string {
  return `${env.APP_PUBLIC_URL.replace(/\/+$/, "")}/api/webhooks/payment/pagbank`;
}

interface PagBankOrderResponse {
  id?: string;
  qr_codes?: { id?: string; text?: string; links?: { media?: string; href?: string }[] }[];
  charges?: { status?: string }[];
}

export const pagBankGateway: PaymentGateway = {
  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const res = await fetch(`${base()}/orders`, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify({
        reference_id: input.externalReference,
        // customer: ajustar aqui se a Fase 0 mostrar que é obrigatório.
        qr_codes: [{ amount: { value: input.amountCents } }], // CENTAVOS (inteiro)
        notification_urls: [notificationUrl()],
      }),
    });
    if (!res.ok) {
      throw new Error(`PagBank: falha ao criar cobrança (${res.status})`);
    }
    const order = (await res.json()) as PagBankOrderResponse;
    const qr = order.qr_codes?.[0];
    const pngLink = qr?.links?.find((l) => l.media === "image/png")?.href;

    return {
      providerChargeId: order.id ?? "",
      pixCopiaECola: qr?.text ?? "",
      pixQrCodeBase64: pngLink, // PagBank devolve URL da imagem (não base64); o front exibe direto
    };
  },

  async isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean> {
    const res = await fetch(`${base()}/orders/${providerChargeId}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) return false;
    const order = (await res.json()) as PagBankOrderResponse;
    return (order.charges ?? []).some((c) => c.status === "PAID");
  },

  async verifyCredential(apiKey: string): Promise<boolean> {
    // Chamada barata autenticada: token inválido → 401/403; qualquer outro → ok.
    const res = await fetch(`${base()}/orders/?reference_id=__verify__`, {
      method: "GET",
      headers: headers(apiKey),
    });
    return res.status !== 401 && res.status !== 403;
  },

  parseWebhookChargeId(body: unknown): string | null {
    const b = body as { id?: string } | null;
    return b?.id ?? null; // root id = id do pedido (= providerChargeId guardado)
  },
};
