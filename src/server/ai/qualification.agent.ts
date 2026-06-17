import { getAnthropic, MODELS } from "./provider";
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
 * Agente de qualificação (Sonnet, tool-use forçado → JSON estruturado).
 * Analisa a conversa inteira e devolve a qualificação validada por zod.
 */
export async function runQualification(opts: {
  leadName: string;
  conversation: ConversationTurn[];
}): Promise<QualificationResult> {
  const client = getAnthropic();

  const res = await client.messages.create({
    model: MODELS.strong,
    max_tokens: 1024,
    system: QUALIFICATION_SYSTEM,
    tools: [
      {
        name: "registrar_qualificacao",
        description: "Registra a qualificação estruturada do lead.",
        input_schema: qualificationJsonSchema as never,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_qualificacao" },
    messages: [
      {
        role: "user",
        content: `Lead: ${opts.leadName}\n\nConversa até agora:\n${transcript(
          opts.conversation,
        )}`,
      },
    ],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Agente de qualificação não retornou tool_use.");
  }

  const parsed = qualificationSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `Saída de qualificação inválida: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
