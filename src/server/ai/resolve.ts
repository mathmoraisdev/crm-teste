import { prisma } from "@/server/db/client";
import { env, isAiConfigured } from "@/lib/env";
import { decryptSecret } from "@/server/crypto";
import { buildAiClient, type AiClient, type AiProviderName } from "./provider";

export interface ResolvedProvider {
  provider: AiProviderName;
  apiKey: string;
  source: "user" | "platform";
}

/**
 * Decide qual provider/chave usar para um usuário:
 *  - se ele configurou a própria chave → usa a dele;
 *  - senão → cai para a chave da plataforma (OPENAI_API_KEY).
 */
export async function resolveProviderForUser(userId: string): Promise<ResolvedProvider> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProvider: true, aiKeyEnc: true },
  });

  if (user?.aiProvider && user.aiKeyEnc) {
    return {
      provider: user.aiProvider,
      apiKey: decryptSecret(user.aiKeyEnc),
      source: "user",
    };
  }

  if (!isAiConfigured) {
    throw new Error(
      "Nenhuma chave de IA disponível: o usuário não configurou a própria e a plataforma não tem OPENAI_API_KEY.",
    );
  }
  return { provider: "OPENAI", apiKey: env.OPENAI_API_KEY, source: "platform" };
}

/**
 * Atalho: AiClient pronto para o usuário (chave própria ou fallback). `model`
 * (opcional) fixa o modelo de todas as chamadas — usado p/ aplicar o modelo
 * configurado por número WhatsApp.
 *
 * Na chave da PLATAFORMA (source="platform"), força TUDO no modelo econômico
 * (`AI_MODEL_CHEAP`) — inclui a qualificação, que internamente pede tier "strong".
 * Assim o custo da nossa chave fica sempre no mini, em todos os planos. BYOK
 * (source="user") mantém a liberdade total: usa o `model` pedido ou os tiers do
 * provider dele.
 */
export async function getAiClient(userId: string, model?: string): Promise<AiClient> {
  const { provider, apiKey, source } = await resolveProviderForUser(userId);
  const effective = source === "platform" ? model ?? env.AI_MODEL_CHEAP : model;
  return buildAiClient({ provider, apiKey, model: effective });
}
