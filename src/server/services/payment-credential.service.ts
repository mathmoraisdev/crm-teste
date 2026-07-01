import { prisma } from "@/server/db/client";
import { isEncryptionConfigured } from "@/lib/env";
import { encryptSecret } from "@/server/crypto";
import { gatewayFor } from "@/server/payments/gateway";
import { assertFeature } from "@/server/services/entitlements";
import type { PaymentProvider } from "@prisma/client";

export interface PaymentCredentialStatus {
  configured: boolean;
  provider: PaymentProvider | null;
  last4: string | null;
  verifiedAt: string | null;
}

export async function getPaymentCredentialStatus(
  userId: string,
): Promise<PaymentCredentialStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { paymentProvider: true, paymentKeyLast4: true, paymentKeyVerifiedAt: true },
  });
  return {
    configured: !!u?.paymentProvider,
    provider: u?.paymentProvider ?? null,
    last4: u?.paymentKeyLast4 ?? null,
    verifiedAt: u?.paymentKeyVerifiedAt ? u.paymentKeyVerifiedAt.toISOString() : null,
  };
}

/**
 * Valida o token contra o gateway do cliente e, se ok, persiste cifrado.
 * Gate: exige a feature `sales` no plano do dono. Lança erro amigável se o
 * token não passar na validação.
 */
export async function savePaymentCredential(
  userId: string,
  provider: PaymentProvider,
  apiKey: string,
): Promise<PaymentCredentialStatus> {
  await assertFeature(userId, "sales");

  const key = apiKey.trim();
  if (key.length < 12) throw new Error("Token de pagamento inválido.");

  // Falha cedo se a plataforma não tem a chave mestra p/ cifrar — sem vazar config.
  if (!isEncryptionConfigured) {
    throw new Error("Recurso indisponível no momento. Tente novamente mais tarde.");
  }

  let ok = false;
  try {
    ok = await gatewayFor(provider).verifyCredential(key);
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error("Não consegui validar o token. Confira o provedor e a chave.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      paymentProvider: provider,
      paymentKeyEnc: encryptSecret(key),
      paymentKeyLast4: key.slice(-4),
      paymentKeyVerifiedAt: new Date(),
    },
  });
  return getPaymentCredentialStatus(userId);
}

export async function removePaymentCredential(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      paymentProvider: null,
      paymentKeyEnc: null,
      paymentKeyLast4: null,
      paymentKeyVerifiedAt: null,
    },
  });
}
