import Anthropic from "@anthropic-ai/sdk";
import { env, isAiConfigured } from "@/lib/env";

/**
 * Cliente Anthropic + tiering de modelos.
 *  - cheap  (Haiku): classificação barata / próxima pergunta / parse de escolha
 *  - strong (Sonnet): qualificação estruturada / decisões
 *
 * Atende diretamente o requisito de "IA barata × forte" do teste.
 */
export const MODELS = {
  cheap: env.AI_MODEL_CHEAP,
  strong: env.AI_MODEL_STRONG,
} as const;

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!isAiConfigured) {
    throw new Error(
      "ANTHROPIC_API_KEY não configurada — a IA é o núcleo do produto. Preencha a chave no .env.",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}
