import { prisma } from "@/server/db/client";
import { encryptSecret } from "@/server/crypto";
import { buildAiClient, type AiProviderName } from "@/server/ai/provider";

export interface AiCredentialStatus {
  configured: boolean;
  provider: AiProviderName | null;
  last4: string | null;
  verifiedAt: string | null;
}

export async function getAiCredentialStatus(userId: string): Promise<AiCredentialStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProvider: true, aiKeyLast4: true, aiKeyVerifiedAt: true },
  });
  return {
    configured: !!u?.aiProvider,
    provider: u?.aiProvider ?? null,
    last4: u?.aiKeyLast4 ?? null,
    verifiedAt: u?.aiKeyVerifiedAt ? u.aiKeyVerifiedAt.toISOString() : null,
  };
}

/** Faz uma chamada barata p/ validar a chave antes de persistir. */
async function testKey(provider: AiProviderName, apiKey: string): Promise<void> {
  const ai = buildAiClient({ provider, apiKey });
  // generateText "cheap" com 1 token: valida auth sem custo relevante.
  await ai.generateText({ tier: "cheap", maxTokens: 1, system: "ping", user: "ping" });
}

/**
 * Valida a chave contra a API do provider e, se ok, persiste cifrada.
 * Lança erro amigável se a chave for inválida.
 */
export async function saveAiCredential(
  userId: string,
  provider: AiProviderName,
  apiKey: string,
): Promise<AiCredentialStatus> {
  const key = apiKey.trim();
  if (key.length < 12) throw new Error("Chave de API inválida.");

  try {
    await testKey(provider, key);
  } catch {
    throw new Error("Não consegui validar a chave. Confira o provider e a chave.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      aiProvider: provider,
      aiKeyEnc: encryptSecret(key),
      aiKeyLast4: key.slice(-4),
      aiKeyVerifiedAt: new Date(),
    },
  });
  return getAiCredentialStatus(userId);
}

export async function removeAiCredential(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { aiProvider: null, aiKeyEnc: null, aiKeyLast4: null, aiKeyVerifiedAt: null },
  });
}
