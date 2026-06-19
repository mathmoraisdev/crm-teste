/**
 * Formatação pura do transcript da conversa para os prompts dos agentes.
 * Sem I/O — fácil de testar e estável (a saída entra direto no prompt do modelo).
 */

export interface ConversationTurn {
  direction: "INBOUND" | "OUTBOUND";
  content: string;
}

/** Lead → "Lead:", Vendedor → "Vendedor:". Uma linha por turno. */
export function formatTranscript(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.direction === "INBOUND" ? "Lead" : "Vendedor"}: ${t.content}`)
    .join("\n");
}
