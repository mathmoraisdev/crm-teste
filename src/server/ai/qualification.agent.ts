import { getOpenAI, MODELS } from "./provider";
import { QUALIFICATION_SYSTEM } from "./prompts";
import {
  qualificationJsonSchema,
  qualificationSchema,
  type QualificationResult,
} from "./schemas";

export interface ConversationTurn {
  direction: "INBOUND" | "OUTBOUND";
  content: string;
}

function transcript(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.direction === "INBOUND" ? "Lead" : "Vendedor"}: ${t.content}`)
    .join("\n");
}

/**
 * Agente de qualificação (gpt-4o, function calling forçado → JSON estruturado).
 * Analisa a conversa inteira e devolve a qualificação validada por zod.
 */
export async function runQualification(opts: {
  leadName: string;
  conversation: ConversationTurn[];
}): Promise<QualificationResult> {
  const client = getOpenAI();

  const res = await client.chat.completions.create({
    model: MODELS.strong,
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: QUALIFICATION_SYSTEM },
      {
        role: "user",
        content: `Lead: ${opts.leadName}\n\nConversa até agora:\n${transcript(
          opts.conversation,
        )}`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "registrar_qualificacao",
          description: "Registra a qualificação estruturada do lead.",
          parameters: qualificationJsonSchema as unknown as Record<string, unknown>,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "registrar_qualificacao" } },
  });

  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") {
    throw new Error("Agente de qualificação não retornou tool_call.");
  }

  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("Agente de qualificação retornou JSON inválido.");
  }

  const parsed = qualificationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Saída de qualificação inválida: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
