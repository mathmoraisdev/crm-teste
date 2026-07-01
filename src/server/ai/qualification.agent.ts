import { QUALIFICATION_SYSTEM } from "./prompts";
import { formatTranscript, type ConversationTurn } from "./transcript";
import {
  qualificationJsonSchema,
  qualificationSchema,
  type QualificationResult,
} from "./schemas";
import type { AiClient } from "./provider";

// Re-export p/ compatibilidade com quem importava ConversationTurn daqui.
export type { ConversationTurn };

/**
 * Agente de qualificação (tier "strong", function calling forçado → JSON estruturado).
 * Analisa a conversa inteira e devolve a qualificação validada por zod.
 * O `ai` (AiClient) é resolvido por-usuário pelo chamador (BYOK).
 */
export async function runQualification(opts: {
  ai: AiClient;
  leadName: string;
  conversation: ConversationTurn[];
  /** Bloco de ofertas ativas (renderActiveOffers). Vazio = número sem vendas. */
  offersBlock?: string;
}): Promise<QualificationResult> {
  const offers = opts.offersBlock?.trim() ? `\n\n${opts.offersBlock.trim()}` : "";
  const input = await opts.ai.forcedToolCall({
    tier: "strong",
    maxTokens: 1024,
    system: QUALIFICATION_SYSTEM,
    user: `Lead: ${opts.leadName}\n\nConversa até agora:\n${formatTranscript(opts.conversation)}${offers}`,
    toolName: "registrar_qualificacao",
    toolDescription: "Registra a qualificação estruturada do lead.",
    jsonSchema: qualificationJsonSchema as unknown as Record<string, unknown>,
  });

  if (input == null) {
    throw new Error("Agente de qualificação não retornou tool_call.");
  }
  const parsed = qualificationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Saída de qualificação inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}
