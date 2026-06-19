import { describe, it, expect } from "vitest";
import type { ConversationTurn } from "./transcript";

// Imports DINÂMICOS: o cliente OpenAI (e a validação de env que ele puxa) só
// carrega quando o eval roda de verdade. Com o eval desligado, nada é importado
// e o arquivo coleta limpo (0 testes), sem exigir DATABASE_URL/OPENAI_API_KEY.
const loadQual = () => import("./qualification.agent").then((m) => m.runQualification);
const loadSlot = () => import("./conversation.agent").then((m) => m.interpretSlotChoice);

/**
 * EVALS COMPORTAMENTAIS (chamam a OpenAI de verdade).
 *
 * Opt-in: rodam só com `RUN_AI_EVALS=1` E uma `OPENAI_API_KEY` setada — assim o
 * `npm test` padrão fica verde, determinístico e sem custo. Para avaliar a
 * qualidade real dos agentes:
 *
 *   RUN_AI_EVALS=1 npm test -- src/server/ai/agents.eval.test.ts
 *
 * As asserções são por FAIXA (não valor exato): LLM não é determinístico, então
 * checamos a decisão de negócio (nextAction / banda de score), não o número.
 */
const enabled = !!process.env.RUN_AI_EVALS && !!process.env.OPENAI_API_KEY;
const EVAL_TIMEOUT = 30_000;

describe.skipIf(!enabled)("eval: runQualification", () => {
  it("lead quente (dor clara + decisor + urgência) → não descarta, score alto", async () => {
    const conv: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Oi Ana! Vi que vocês vendem pelo WhatsApp. Posso te mostrar como automatizar?" },
      { direction: "INBOUND", content: "Pode sim. Hoje perco muita venda porque não dou conta de responder todo mundo a tempo." },
      { direction: "OUTBOUND", content: "Entendi. Você é quem decide sobre ferramentas aí?" },
      { direction: "INBOUND", content: "Sou a dona. Quero resolver isso essa semana ainda, tá me custando caro." },
    ];
    const runQualification = await loadQual();
    const q = await runQualification({ leadName: "Ana", conversation: conv });
    expect(q.nextAction).not.toBe("discard");
    expect(q.score).toBeGreaterThanOrEqual(55);
    expect(["alto", "medio"]).toContain(q.interestLevel);
  }, EVAL_TIMEOUT);

  it("lead sem interesse explícito → discard ou score baixo", async () => {
    const conv: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Oi! Posso te apresentar nossa solução de prospecção?" },
      { direction: "INBOUND", content: "Não tenho interesse. Para de me mandar mensagem, por favor." },
    ];
    const runQualification = await loadQual();
    const q = await runQualification({ leadName: "Carlos", conversation: conv });
    expect(q.nextAction === "discard" || q.score < 40).toBe(true);
  }, EVAL_TIMEOUT);

  it("lead novo/neutro (só um oi) → continua qualificando, não descarta nem agenda", async () => {
    const conv: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Oi Marina, tudo bem? Posso te fazer uma pergunta rápida sobre o seu atendimento?" },
      { direction: "INBOUND", content: "Oi, quem é?" },
    ];
    const runQualification = await loadQual();
    const q = await runQualification({ leadName: "Marina", conversation: conv });
    expect(q.nextAction).toBe("ask_question");
  }, EVAL_TIMEOUT);

  it("captura e-mail quando informado; nunca inventa quando ausente", async () => {
    const runQualification = await loadQual();
    const withEmail: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Qual seu melhor e-mail pra eu te enviar os detalhes?" },
      { direction: "INBOUND", content: "manda pra ana.silva@loja.com.br" },
    ];
    const a = await runQualification({ leadName: "Ana", conversation: withEmail });
    expect(a.email).toContain("ana.silva@loja.com.br");

    const noEmail: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Tudo bem?" },
      { direction: "INBOUND", content: "Tudo, e aí?" },
    ];
    const b = await runQualification({ leadName: "Ana", conversation: noEmail });
    expect(b.email).toBeNull();
  }, EVAL_TIMEOUT);
});

describe.skipIf(!enabled)("eval: interpretSlotChoice", () => {
  const slots = ["Terça 14h", "Quarta 10h", "Quinta 16h"];

  it("entende escolha por número", async () => {
    const interpretSlotChoice = await loadSlot();
    const r = await interpretSlotChoice({ formattedSlots: slots, leadMessage: "pode ser a 2" });
    expect(r.chosenIndex).toBe(1);
    expect(r.confident).toBe(true);
  }, EVAL_TIMEOUT);

  it("entende escolha por descrição do horário", async () => {
    const interpretSlotChoice = await loadSlot();
    const r = await interpretSlotChoice({ formattedSlots: slots, leadMessage: "quinta às 16 fica ótimo" });
    expect(r.chosenIndex).toBe(2);
  }, EVAL_TIMEOUT);

  it("resposta ambígua → não força escolha", async () => {
    const interpretSlotChoice = await loadSlot();
    const r = await interpretSlotChoice({ formattedSlots: slots, leadMessage: "qualquer um tá bom" });
    expect(r.confident === false || r.chosenIndex === null).toBe(true);
  }, EVAL_TIMEOUT);
});
