import type { PaymentProvider } from "@prisma/client";
import { asaasGateway } from "./asaas";
import { mercadoPagoGateway } from "./mercadopago";

export interface CreatePixChargeInput {
  apiKey: string;
  amountCents: number;
  description: string;
  externalReference: string; // = Sale.id, p/ reconciliar
  payerName?: string;
}

export interface PixCharge {
  providerChargeId: string;
  pixCopiaECola: string;
  pixQrCodeBase64?: string;
}

export interface PaymentGateway {
  /** Cria a cobrança Pix na conta do cliente. */
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  /** Consulta status atual (fonte de verdade). Retorna true se PAGO. */
  isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean>;
  /** Valida a credencial (chamada barata) — usado ao salvar o token. */
  verifyCredential(apiKey: string): Promise<boolean>;
  /** Extrai o providerChargeId do corpo do webhook (sem confiar em status). */
  parseWebhookChargeId(body: unknown): string | null;
}

export function gatewayFor(provider: PaymentProvider): PaymentGateway {
  return provider === "ASAAS" ? asaasGateway : mercadoPagoGateway;
}
