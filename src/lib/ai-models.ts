/**
 * Catálogo de modelos oferecidos no seletor "Modelo de IA" por número.
 *
 * Arquivo SEM dependência dos SDKs (provider.ts importa openai/@anthropic-ai) —
 * por isso pode ser importado tanto no client (UI do painel) quanto no server
 * (validação do PATCH). A lista exibida adapta ao provider configurado do usuário.
 */

export type AiProviderName = "OPENAI" | "ANTHROPIC";

export interface AiModelOption {
  value: string; // ID exato do modelo na API do provider
  label: string; // nome amigável exibido na UI
}

export const AI_MODELS_BY_PROVIDER: Record<AiProviderName, AiModelOption[]> = {
  OPENAI: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  ANTHROPIC: [
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

/** Todos os IDs válidos (qualquer provider) — usado p/ validar o PATCH no backend. */
export const ALL_AI_MODEL_VALUES = new Set<string>(
  Object.values(AI_MODELS_BY_PROVIDER).flat().map((m) => m.value),
);
