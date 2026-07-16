import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import type { AiProviderName, Tier } from "./provider";

/**
 * Contexto de uma chamada de IA dentro do fluxo de uma conversa: a conta e o
 * lead que a dispararam + um `purpose` legível p/ o dashboard de custo. Setado
 * por `runWithAiCallContext` (respondToLead / suggestAttendanceReply) e lido
 * pelo provider ao gravar a linha de auditoria — sem precisar propagatear
 * leadId/userId pela assinatura de cada agent (6 funções) e método do AiClient.
 *
 * Fora de um `runWithAiCallContext` (ex.: validação de chave em
 * ai-credential.service) o contexto é `null` e NENHUMA linha é gravada: a
 * chamada continua funcionando, só não audita custo.
 */
export interface AiCallContext {
  userId: string;
  leadId: string;
  purpose: string; // "qualification" | "attendance" | "next_question" | ...
}

const als = new AsyncLocalStorage<AiCallContext>();

/** Devolve o contexto da chamada corrente, ou `null` se não houver. */
export function getAiCallContext(): AiCallContext | null {
  return als.getStore() ?? null;
}

/** Executa `fn` com um contexto de chamada de IA ativo (gravado pelo provider). */
export function runWithAiCallContext<T>(ctx: AiCallContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

// ───────────────────── Custo estimado por modelo ─────────────────────
// Preços públicos (USD por 1M de tokens), convertidos p/ centavos por 1 token.
// Fonte: páginas de pricing da OpenAI e Anthropic. Best-effort: se um modelo
// novo não estiver mapeado, cai no fallback do tier (erro de p/ cima, nunca 0).
// 1 USD ≈ 500 centavos de R$ (cotação conservadora arredondada p/ baixo).
const USD_PER_BRL = 5; // 1 USD = 5 BRL → ×100 = 500 centavos
const PER_MILLION = 1_000_000;

interface ModelPrice {
  promptCentsPer1M: number; // centavos de R$ por 1M tokens de entrada
  completionCentsPer1M: number; // centavos de R$ por 1M tokens de saída
}

// Preço em USD/1M → centavos de R$/1M: (usd × USD_PER_BRL × 100).
function usd(usdIn: number, usdOut: number): ModelPrice {
  return {
    promptCentsPer1M: Math.round(usdIn * USD_PER_BRL * 100),
    completionCentsPer1M: Math.round(usdOut * USD_PER_BRL * 100),
  };
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI — gpt-4o family
  "gpt-4o": usd(2.5, 10),
  "gpt-4o-mini": usd(0.15, 0.6),
  // OpenAI — gpt-4.1 family
  "gpt-4.1": usd(2.0, 8.0),
  "gpt-4.1-mini": usd(0.4, 1.6),
  "gpt-4.1-nano": usd(0.1, 0.4),
  // OpenAI — legados
  "gpt-4-turbo": usd(10, 30),
  "gpt-3.5-turbo": usd(0.5, 1.5),
  // Anthropic
  "claude-opus-4-8": usd(15, 75),
  "claude-sonnet-4-6": usd(3, 15),
  "claude-haiku-4-5": usd(0.8, 4),
};

// Fallback por tier (modelos desconhecidos): usa o preço do tier p/ não zerar.
const TIER_FALLBACK: Record<Tier, ModelPrice> = {
  cheap: MODEL_PRICES["gpt-4o-mini"],
  strong: MODEL_PRICES["gpt-4o"],
};

/** Estima o custo em CENTAVOS de R$ dados os tokens e o modelo/tier. */
export function estimateCostCents(
  model: string,
  tier: Tier,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = MODEL_PRICES[model] ?? TIER_FALLBACK[tier];
  const cost =
    (promptTokens / PER_MILLION) * price.promptCentsPer1M +
    (completionTokens / PER_MILLION) * price.completionCentsPer1M;
  return Math.max(1, Math.round(cost)); // mín. 1 centavo p/ registrar consumo real
}

/**
 * Grava UMA linha de auditoria de chamada de IA. Fire-and-forget: nunca lança
 * (falha de log não derruba a resposta do lead). Só grava quando há contexto
 * (dentro de runWithAiCallContext); fora dele é no-op.
 */
export function recordAiCall(opts: {
  provider: AiProviderName;
  model: string;
  tier: Tier;
  promptTokens: number;
  completionTokens: number;
  error?: boolean;
}): void {
  const ctx = getAiCallContext();
  if (!ctx) return; // fora de uma conversa — não audita

  const { provider, model, tier, promptTokens, completionTokens, error = false } = opts;
  const totalTokens = promptTokens + completionTokens;
  const costCents = error
    ? 0
    : estimateCostCents(model, tier, promptTokens, completionTokens);

  // Sem await: o caminho crítico (resposta do lead) não espera a inserção.
  prisma.aiCallLog
    .create({
      data: {
        userId: ctx.userId,
        leadId: ctx.leadId,
        provider,
        model,
        tier,
        purpose: ctx.purpose,
        promptTokens,
        completionTokens,
        totalTokens,
        costCents,
        error,
      },
    })
    .catch((err) => {
      logger.warn({ err, ctx, model, tier }, "[ai-call-log] falha ao gravar auditoria de custo");
    });
}
