import { prisma } from "@/server/db/client";
import { decryptSecret } from "@/server/crypto";
import type { PaymentProvider } from "@prisma/client";

export interface ResolvedPayment {
  provider: PaymentProvider;
  apiKey: string;
}

/** Credencial de pagamento do dono (null = cliente não configurou → vendas off). */
export async function resolvePaymentForUser(userId: string): Promise<ResolvedPayment | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { paymentProvider: true, paymentKeyEnc: true },
  });
  if (!u?.paymentProvider || !u.paymentKeyEnc) return null;
  return { provider: u.paymentProvider, apiKey: decryptSecret(u.paymentKeyEnc) };
}
