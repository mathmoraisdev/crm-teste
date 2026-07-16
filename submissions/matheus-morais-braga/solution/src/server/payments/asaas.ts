import { env } from "@/lib/env";
import type {
  CreatePixChargeInput,
  PaymentGateway,
  PixCharge,
} from "./gateway";

/**
 * Gateway Asaas (Pix). Auth por header `access_token`. Base sandbox/prod via
 * env.ASAAS_BASE_URL. Fluxo: cria a cobrança PIX, depois busca o copia-e-cola.
 *
 * Docs: https://docs.asaas.com/docs/cobrancas-via-pix
 */
function base(): string {
  return env.ASAAS_BASE_URL.replace(/\/+$/, "");
}

function headers(apiKey: string): Record<string, string> {
  return { access_token: apiKey, "Content-Type": "application/json" };
}

/** Data de vencimento (hoje) no formato YYYY-MM-DD exigido pelo Asaas. */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export const asaasGateway: PaymentGateway = {
  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const res = await fetch(`${base()}/v3/payments`, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify({
        billingType: "PIX",
        value: input.amountCents / 100, // Asaas usa reais (decimal)
        dueDate: todayISODate(),
        description: input.description,
        externalReference: input.externalReference,
      }),
    });
    if (!res.ok) {
      throw new Error(`Asaas: falha ao criar cobrança (${res.status})`);
    }
    const payment = (await res.json()) as { id: string };

    const qrRes = await fetch(`${base()}/v3/payments/${payment.id}/pixQrCode`, {
      method: "GET",
      headers: headers(input.apiKey),
    });
    if (!qrRes.ok) {
      throw new Error(`Asaas: falha ao obter QR Pix (${qrRes.status})`);
    }
    const qr = (await qrRes.json()) as { payload: string; encodedImage?: string };

    return {
      providerChargeId: payment.id,
      pixCopiaECola: qr.payload,
      pixQrCodeBase64: qr.encodedImage,
    };
  },

  async isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean> {
    const res = await fetch(`${base()}/v3/payments/${providerChargeId}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) return false;
    const payment = (await res.json()) as { status?: string };
    return payment.status === "RECEIVED" || payment.status === "CONFIRMED";
  },

  async verifyCredential(apiKey: string): Promise<boolean> {
    const res = await fetch(`${base()}/v3/myAccount`, {
      method: "GET",
      headers: headers(apiKey),
    });
    return res.ok;
  },

  parseWebhookChargeId(body: unknown): string | null {
    const b = body as { payment?: { id?: string } } | null;
    return b?.payment?.id ?? null;
  },
};
