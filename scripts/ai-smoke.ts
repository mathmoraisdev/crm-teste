import { runQualification, type ConversationTurn } from "@/server/ai/qualification.agent";
import { generateNextQuestion } from "@/server/ai/conversation.agent";
import { buildAiClient } from "@/server/ai/provider";

/**
 * Smoke da camada de IA (OpenAI): roda a qualificação estruturada + a próxima
 * pergunta com uma conversa fake. Uso: npm run ai:smoke
 * NÃO imprime a chave — só os resultados do modelo.
 */
async function main() {
  const conversation: ConversationTurn[] = [
    {
      direction: "OUTBOUND",
      content:
        "Oi João! Vi que você tem uma loja de roupas. Posso te mostrar como automatizar o atendimento no WhatsApp?",
    },
    {
      direction: "INBOUND",
      content:
        "Oi, tenho sim. Hoje perco muita venda porque demoro pra responder os clientes. Quanto custa?",
    },
  ];

  // Smoke usa a chave da plataforma direto (sem resolução por-usuário).
  const ai = buildAiClient({
    provider: "OPENAI",
    apiKey: process.env.OPENAI_API_KEY ?? "",
  });

  console.log("→ Qualificação estruturada (gpt-4o, function calling)…");
  const qual = await runQualification({ ai, leadName: "João", conversation });
  console.log(JSON.stringify(qual, null, 2));

  console.log("\n→ Próxima pergunta (gpt-4o-mini)…");
  const next = await generateNextQuestion({
    ai,
    leadName: "João",
    conversation,
    qualification: qual,
  });
  console.log(next);

  console.log("\n✅ OpenAI respondeu — camada de IA OK.");
}

main().catch((e) => {
  console.error("❌ Falha na IA:", e instanceof Error ? e.message : e);
  process.exit(1);
});
