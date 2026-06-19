import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export type AiProviderName = "OPENAI" | "ANTHROPIC";

/** Tiering de modelos por provider (cheap = barato/rápido, strong = decisões). */
export const MODELS_BY_PROVIDER = {
  OPENAI: { cheap: env.AI_MODEL_CHEAP, strong: env.AI_MODEL_STRONG },
  ANTHROPIC: { cheap: "claude-haiku-4-5", strong: "claude-opus-4-8" },
} as const;

export type Tier = "cheap" | "strong";

export interface ForcedToolCallOpts {
  tier: Tier;
  system: string;
  user: string;
  maxTokens: number;
  toolName: string;
  toolDescription: string;
  /** JSON Schema dos parâmetros da tool. */
  jsonSchema: Record<string, unknown>;
}

export interface GenerateTextOpts {
  tier: Tier;
  system: string;
  user: string;
  maxTokens: number;
}

/**
 * Abstração mínima sobre os dois SDKs. Dois usos no produto:
 *  - generateText: 1 saída de texto livre (próxima pergunta).
 *  - forcedToolCall: força chamada de 1 tool → objeto JSON (qualificação, slot).
 * Retorna o objeto de argumentos cru (ou null se o modelo não chamou a tool);
 * a validação zod fica no chamador.
 */
export interface AiClient {
  generateText(opts: GenerateTextOpts): Promise<string>;
  forcedToolCall(opts: ForcedToolCallOpts): Promise<unknown | null>;
}

// ───────────────────────── OpenAI ─────────────────────────

function openAiClient(apiKey: string): AiClient {
  const client = new OpenAI({ apiKey });
  const models = MODELS_BY_PROVIDER.OPENAI;

  return {
    async generateText({ tier, system, user, maxTokens }) {
      const res = await client.chat.completions.create({
        model: models[tier],
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return (res.choices[0]?.message?.content ?? "").trim();
    },

    async forcedToolCall({ tier, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.chat.completions.create({
        model: models[tier],
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: toolName,
              description: toolDescription,
              parameters: jsonSchema as unknown as Record<string, unknown>,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: toolName } },
      });
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call || call.type !== "function") return null;
      try {
        return JSON.parse(call.function.arguments);
      } catch {
        return null;
      }
    },
  };
}

// ──────────────────────── Anthropic ────────────────────────

function anthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey });
  const models = MODELS_BY_PROVIDER.ANTHROPIC;

  return {
    async generateText({ tier, system, user, maxTokens }) {
      const res = await client.messages.create({
        model: models[tier],
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text.trim() : "";
    },

    async forcedToolCall({ tier, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.messages.create({
        model: models[tier],
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: toolName },
      });
      const block = res.content.find((b) => b.type === "tool_use");
      // input já vem como objeto parseado no SDK da Anthropic.
      return block && block.type === "tool_use" ? block.input : null;
    },
  };
}

/** Constrói um AiClient para um provider + chave específicos. */
export function buildAiClient(opts: { provider: AiProviderName; apiKey: string }): AiClient {
  return opts.provider === "ANTHROPIC"
    ? anthropicClient(opts.apiKey)
    : openAiClient(opts.apiKey);
}
