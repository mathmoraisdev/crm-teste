import type {
  AiClient,
  RunToolLoopOpts,
  RunToolLoopResult,
  ToolDef,
} from "../provider";

/** Um passo roteirizado: a tool que o "modelo" decide chamar, com seus args. */
export interface ScriptedStep {
  call: string;
  args: unknown;
}

export interface ScriptedToolLoopOpts {
  /** Texto final devolvido quando o script termina sem `stop`. */
  finalText?: string;
}

/**
 * `AiClient` fake e DETERMINÍSTICO para testar o wiring da camada de conversa e
 * os handlers das tools — sem tocar na OpenAI/Anthropic.
 *
 * `runToolLoop` executa os handlers REAIS passados em `opts.tools`, na ordem do
 * `script`, respeitando `stop` (um handler que devolve `stop:true` encerra o
 * loop com `stopped:true` e texto vazio). `generateText`/`forcedToolCall` lançam
 * — este client existe só para o caminho agêntico.
 */
export function makeScriptedToolLoopClient(
  script: ScriptedStep[],
  opts: ScriptedToolLoopOpts = {},
): AiClient {
  const finalText = opts.finalText ?? "Posso ajudar em algo mais?";
  return {
    generateText: async () => {
      throw new Error("generateText não é usado no fake de tool-loop");
    },
    forcedToolCall: async () => {
      throw new Error("forcedToolCall não é usado no fake de tool-loop");
    },
    async runToolLoop(loopOpts: RunToolLoopOpts): Promise<RunToolLoopResult> {
      const byName = new Map<string, ToolDef>(loopOpts.tools.map((t) => [t.name, t]));
      const toolsUsed: string[] = [];
      for (const step of script) {
        const tool = byName.get(step.call);
        if (!tool) {
          throw new Error(
            `script chama tool "${step.call}" que não foi registrada (tools: ${[...byName.keys()].join(", ") || "nenhuma"})`,
          );
        }
        const res = await tool.handler(step.args);
        toolsUsed.push(step.call);
        if (res.stop) return { text: "", toolsUsed, stopped: true };
      }
      return { text: finalText, toolsUsed, stopped: false };
    },
  };
}
