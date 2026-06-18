import OpenAI from "openai";
import { env, isAiConfigured } from "@/lib/env";

/**
 * Cliente OpenAI + tiering de modelos.
 *  - cheap  (gpt-4o-mini): classificação barata / próxima pergunta / parse de escolha
 *  - strong (gpt-4o): qualificação estruturada / decisões
 *
 * Atende diretamente o requisito de "IA barata × forte" do teste.
 */
export const MODELS = {
  cheap: env.AI_MODEL_CHEAP,
  strong: env.AI_MODEL_STRONG,
} as const;

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!isAiConfigured) {
    throw new Error(
      "OPENAI_API_KEY não configurada — a IA é o núcleo do produto. Preencha a chave no .env.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}
