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
  /** Override do modelo (ID do provider). Quando ausente, usa o do client/`tier`. */
  model?: string;
}

export interface GenerateTextOpts {
  tier: Tier;
  system: string;
  user: string;
  maxTokens: number;
  /** Override do modelo (ID do provider). Quando ausente, usa o do client/`tier`. */
  model?: string;
}

// ───────────────────────── Tool-loop (agente) ─────────────────────────

/** Resultado devolvido por um handler de tool ao modelo. */
export interface ToolResult {
  /** Texto do resultado que volta ao modelo (fica visível no próximo passo). */
  content: string;
  /** Quando true, o loop encerra imediatamente (a tool já produziu o efeito/turno). */
  stop?: boolean;
}

/** Uma tool disponível para o loop: descrição + schema + handler que a executa. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema dos parâmetros da tool. */
  jsonSchema: Record<string, unknown>;
  /** Executa a tool com os args já parseados (objeto cru); devolve o resultado ao modelo. */
  handler: (args: unknown) => Promise<ToolResult>;
}

/** Mensagem do transcript convertida p/ o loop (papel + texto puro). */
export interface LoopMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunToolLoopOpts {
  tier: Tier;
  system: string;
  messages: LoopMessage[];
  tools: ToolDef[];
  maxTokens: number;
  /** Teto de passos (round-trips) antes de encerrar. Default 4. */
  maxSteps?: number;
  /** Override do modelo (ID do provider). Quando ausente, usa o do client/`tier`. */
  model?: string;
}

export interface RunToolLoopResult {
  /** Texto final ao cliente (vazio quando uma tool com `stop` encerrou o turno). */
  text: string;
  /** Nomes das tools executadas, na ordem em que rodaram. */
  toolsUsed: string[];
  /** True quando um handler pediu `stop` (o turno já foi encerrado pela tool). */
  stopped: boolean;
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
  /**
   * Loop de tools (agente): roda até `maxSteps` round-trips com `tool_choice: auto`,
   * chamando os handlers das `tools` fornecidas pelo chamador e devolvendo o
   * resultado ao modelo até ele parar de chamar tools (ou uma tool pedir `stop`).
   */
  runToolLoop(opts: RunToolLoopOpts): Promise<RunToolLoopResult>;
}

// ───────────────────────── OpenAI ─────────────────────────

function openAiClient(apiKey: string, clientModel?: string): AiClient {
  const client = new OpenAI({
    apiKey,
    timeout: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });
  const models = MODELS_BY_PROVIDER.OPENAI;
  // Precedência: override da chamada → modelo do client (por-número) → padrão do tier.
  const pick = (tier: Tier, callModel?: string) => callModel || clientModel || models[tier];

  return {
    async generateText({ tier, model, system, user, maxTokens }) {
      const res = await client.chat.completions.create({
        model: pick(tier, model),
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return (res.choices[0]?.message?.content ?? "").trim();
    },

    async forcedToolCall({ tier, model, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.chat.completions.create({
        model: pick(tier, model),
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

    async runToolLoop({ tier, model, system, messages, tools, maxTokens, maxSteps }) {
      const steps = maxSteps ?? 4;
      const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.jsonSchema },
      }));
      const byName = new Map(tools.map((t) => [t.name, t]));
      const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const toolsUsed: string[] = [];
      let lastText = "";

      for (let step = 0; step < steps; step++) {
        const res = await client.chat.completions.create({
          model: pick(tier, model),
          max_completion_tokens: maxTokens,
          messages: convo,
          tools: openaiTools,
          tool_choice: "auto",
        });
        const msg = res.choices[0]?.message;
        const calls = msg?.tool_calls ?? [];
        if (msg?.content) lastText = msg.content.trim();

        // Sem tool_calls → o modelo respondeu; devolve o texto.
        if (!calls.length) {
          return { text: lastText, toolsUsed, stopped: false };
        }

        // Precisa registrar a assistant message (com os tool_calls) antes dos results.
        convo.push(msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);

        let stopped = false;
        for (const call of calls) {
          if (call.type !== "function") continue;
          const tool = byName.get(call.function.name);
          let result: ToolResult;
          if (!tool) {
            result = { content: `Tool desconhecida: ${call.function.name}` };
          } else {
            let args: unknown;
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch {
              args = {};
            }
            try {
              result = await tool.handler(args);
            } catch (err) {
              result = { content: `Erro ao executar ${call.function.name}: ${(err as Error).message}` };
            }
            toolsUsed.push(call.function.name);
          }
          convo.push({ role: "tool", tool_call_id: call.id, content: result.content });
          if (result.stop) stopped = true;
        }
        // Uma tool com efeito colateral encerra o turno (ex.: escalar).
        if (stopped) return { text: "", toolsUsed, stopped: true };
      }

      // Estourou maxSteps → devolve o último texto (ou "").
      return { text: lastText, toolsUsed, stopped: false };
    },
  };
}

// ──────────────────────── Anthropic ────────────────────────

function anthropicClient(apiKey: string, clientModel?: string): AiClient {
  const client = new Anthropic({
    apiKey,
    timeout: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });
  const models = MODELS_BY_PROVIDER.ANTHROPIC;
  // Precedência: override da chamada → modelo do client (por-número) → padrão do tier.
  const pick = (tier: Tier, callModel?: string) => callModel || clientModel || models[tier];

  return {
    async generateText({ tier, model, system, user, maxTokens }) {
      const res = await client.messages.create({
        model: pick(tier, model),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text.trim() : "";
    },

    async forcedToolCall({ tier, model, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.messages.create({
        model: pick(tier, model),
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

    async runToolLoop({ tier, model, system, messages, tools, maxTokens, maxSteps }) {
      const steps = maxSteps ?? 4;
      const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.jsonSchema as Anthropic.Tool.InputSchema,
      }));
      const byName = new Map(tools.map((t) => [t.name, t]));
      const convo: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const toolsUsed: string[] = [];
      let lastText = "";

      for (let step = 0; step < steps; step++) {
        const res = await client.messages.create({
          model: pick(tier, model),
          max_tokens: maxTokens,
          system,
          messages: convo,
          tools: anthropicTools,
        });

        // Acumula texto e coleta os blocos tool_use deste passo.
        const textBlocks = res.content.filter((b) => b.type === "text");
        if (textBlocks.length) {
          lastText = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join("").trim();
        }
        const toolUses = res.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        if (res.stop_reason !== "tool_use" || !toolUses.length) {
          return { text: lastText, toolsUsed, stopped: false };
        }

        // Registra a resposta do assistente (com os blocos tool_use) e monta os results.
        convo.push({ role: "assistant", content: res.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        let stopped = false;
        for (const use of toolUses) {
          const tool = byName.get(use.name);
          let result: ToolResult;
          if (!tool) {
            result = { content: `Tool desconhecida: ${use.name}` };
          } else {
            try {
              result = await tool.handler(use.input);
            } catch (err) {
              result = { content: `Erro ao executar ${use.name}: ${(err as Error).message}` };
            }
            toolsUsed.push(use.name);
          }
          results.push({ type: "tool_result", tool_use_id: use.id, content: result.content });
          if (result.stop) stopped = true;
        }
        convo.push({ role: "user", content: results });
        if (stopped) return { text: "", toolsUsed, stopped: true };
      }

      return { text: lastText, toolsUsed, stopped: false };
    },
  };
}

/**
 * Constrói um AiClient para um provider + chave específicos. `model` (opcional)
 * fixa o modelo de TODAS as chamadas deste client (override por-número), ainda
 * sujeito a um override per-call. Sem ele, cai no modelo padrão do tier.
 */
export function buildAiClient(opts: {
  provider: AiProviderName;
  apiKey: string;
  model?: string;
}): AiClient {
  return opts.provider === "ANTHROPIC"
    ? anthropicClient(opts.apiKey, opts.model)
    : openAiClient(opts.apiKey, opts.model);
}
