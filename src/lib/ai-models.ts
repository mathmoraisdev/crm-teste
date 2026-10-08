/**
 * Catálogo de modelos oferecidos no seletor "Modelo de IA" por número.
 *
 * Arquivo SEM dependência dos SDKs (provider.ts importa openai/@anthropic-ai) —
 * por isso pode ser importado tanto no client (UI do painel) quanto no server
 * (validação do PATCH). A lista exibida adapta ao provider configurado do usuário.
 */

export type AiProviderName = "OPENAI" | "ANTHROPIC";

export type Tier = "cheap" | "strong";

export interface AiModelOption {
  value: string; // ID exato do modelo na API do provider
  label: string; // nome amigável exibido na UI
  tier: Tier;    // cheap = econômico (peso 1); strong = avançado (peso STRONG_CREDIT_WEIGHT)
}

/** Peso de crédito do tier avançado (placeholder — calibrar pelo custo real). */
export const STRONG_CREDIT_WEIGHT = 10;

export const AI_MODELS_BY_PROVIDER: Record<AiProviderName, AiModelOption[]> = {
  OPENAI: [
    { value: "gpt-luna-6", label: "GPT LUNA 6", tier: "strong" },
    { value: "gpt-4o", label: "GPT-4o", tier: "strong" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "cheap" },
    { value: "gpt-4.1", label: "GPT-4.1", tier: "strong" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", tier: "cheap" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", tier: "cheap" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", tier: "strong" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", tier: "cheap" },
  ],
  ANTHROPIC: [
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", tier: "strong" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "strong" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "cheap" },
  ],
};

const TIER_BY_MODEL = new Map<string, Tier>(
  Object.values(AI_MODELS_BY_PROVIDER).flat().map((m) => [m.value, m.tier]),
);

/** Tier de um modelo. null/vazio/desconhecido → "cheap" (default econômico seguro). */
export function modelTier(model: string | null | undefined): Tier {
  return (model && TIER_BY_MODEL.get(model)) || "cheap";
}

/** Peso de crédito consumido por 1 atendimento neste modelo. */
export function modelCreditWeight(model: string | null | undefined): number {
  return modelTier(model) === "strong" ? STRONG_CREDIT_WEIGHT : 1;
}

/** Todos os IDs válidos (qualquer provider) — usado p/ validar o PATCH no backend. */
export const ALL_AI_MODEL_VALUES = new Set<string>(
  Object.values(AI_MODELS_BY_PROVIDER).flat().map((m) => m.value),
);
