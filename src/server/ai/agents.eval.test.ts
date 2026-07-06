import { describe, it, expect } from "vitest";
import type { ConversationTurn } from "./transcript";

// Imports DINÂMICOS: o cliente OpenAI (e a validação de env que ele puxa) só
// carrega quando o eval roda de verdade. Com o eval desligado, nada é importado
// e o arquivo coleta limpo (0 testes), sem exigir DATABASE_URL/OPENAI_API_KEY.
const loadQual = () => import("./qualification.agent").then((m) => m.runQualification);
const loadSlot = () => import("./conversation.agent").then((m) => m.interpretSlotChoice);
const loadAgentic = () => import("./conversation.agent").then((m) => m.generateAgenticReply);
// AiClient de plataforma (OpenAI), construído dinamicamente p/ não puxar env
// quando o eval está desligado.
const loadAi = () =>
  import("./provider").then((m) =>
    m.buildAiClient({ provider: "OPENAI", apiKey: process.env.OPENAI_API_KEY ?? "" }),
  );

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
    const ai = await loadAi();
    const q = await runQualification({ ai, leadName: "Ana", conversation: conv });
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
    const ai = await loadAi();
    const q = await runQualification({ ai, leadName: "Carlos", conversation: conv });
    expect(q.nextAction === "discard" || q.score < 40).toBe(true);
  }, EVAL_TIMEOUT);

  it("lead novo/neutro (só um oi) → continua qualificando, não descarta nem agenda", async () => {
    const conv: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Oi Marina, tudo bem? Posso te fazer uma pergunta rápida sobre o seu atendimento?" },
      { direction: "INBOUND", content: "Oi, quem é?" },
    ];
    const runQualification = await loadQual();
    const ai = await loadAi();
    const q = await runQualification({ ai, leadName: "Marina", conversation: conv });
    expect(q.nextAction).toBe("ask_question");
  }, EVAL_TIMEOUT);

  it("captura e-mail quando informado; nunca inventa quando ausente", async () => {
    const runQualification = await loadQual();
    const ai = await loadAi();
    const withEmail: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Qual seu melhor e-mail pra eu te enviar os detalhes?" },
      { direction: "INBOUND", content: "manda pra ana.silva@loja.com.br" },
    ];
    const a = await runQualification({ ai, leadName: "Ana", conversation: withEmail });
    expect(a.email).toContain("ana.silva@loja.com.br");

    const noEmail: ConversationTurn[] = [
      { direction: "OUTBOUND", content: "Tudo bem?" },
      { direction: "INBOUND", content: "Tudo, e aí?" },
    ];
    const b = await runQualification({ ai, leadName: "Ana", conversation: noEmail });
    expect(b.email).toBeNull();
  }, EVAL_TIMEOUT);
});

describe.skipIf(!enabled)("eval: interpretSlotChoice", () => {
  const slots = ["Terça 14h", "Quarta 10h", "Quinta 16h"];

  it("entende escolha por número", async () => {
    const interpretSlotChoice = await loadSlot();
    const ai = await loadAi();
    const r = await interpretSlotChoice({ ai, formattedSlots: slots, leadMessage: "pode ser a 2" });
    expect(r.chosenIndex).toBe(1);
    expect(r.confident).toBe(true);
  }, EVAL_TIMEOUT);

  it("entende escolha por descrição do horário", async () => {
    const interpretSlotChoice = await loadSlot();
    const ai = await loadAi();
    const r = await interpretSlotChoice({ ai, formattedSlots: slots, leadMessage: "quinta às 16 fica ótimo" });
    expect(r.chosenIndex).toBe(2);
  }, EVAL_TIMEOUT);

  it("resposta ambígua → não força escolha", async () => {
    const interpretSlotChoice = await loadSlot();
    const ai = await loadAi();
    const r = await interpretSlotChoice({ ai, formattedSlots: slots, leadMessage: "qualquer um tá bom" });
    expect(r.confident === false || r.chosenIndex === null).toBe(true);
  }, EVAL_TIMEOUT);
});

describe.skipIf(!enabled)("eval: attendance tool-calling", () => {
  // Tools "fake" (sem DB/WhatsApp): catálogo pequeno fixo + flag de envio. A
  // asserção é por TOOL CHAMADA (toolsUsed), não pelo texto exato (não-determinístico).
  function fakeTools() {
    const sent: string[] = [];
    const tools = [
      {
        name: "consultar_estoque",
        description:
          "Consulta o catálogo e o estoque ao vivo. Use para responder preço/disponibilidade.",
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: { query: { type: "string", description: "filtro por nome (opcional)" } },
        },
        handler: async () => ({ content: "id=ci_1 | Corte | R$ 40,00 | estoque=—" }),
      },
      {
        name: "enviar_catalogo",
        description:
          "Envia ao cliente, pelo WhatsApp, a lista de produtos/serviços com preços. Use quando ele pedir o cardápio/catálogo.",
        jsonSchema: { type: "object", additionalProperties: false, properties: {} },
        handler: async () => {
          sent.push("catalogo");
          return { content: "catálogo enviado" };
        },
      },
    ];
    return { tools, sent };
  }

  it("'quanto tá o corte?' → consulta o estoque (ou responde o preço)", async () => {
    const ai = await loadAi();
    const generateAgenticReply = await loadAgentic();
    const { tools } = fakeTools();
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Barbearia do Zé", persona: "direto e simpático" },
      conversation: [{ direction: "INBOUND", content: "quanto tá o corte?" }],
      tools,
    });
    expect(r.toolsUsed.includes("consultar_estoque") || /40|R\$/.test(r.text)).toBe(true);
  }, EVAL_TIMEOUT);

  it("'me manda o cardápio' → envia o catálogo", async () => {
    const ai = await loadAi();
    const generateAgenticReply = await loadAgentic();
    const { tools, sent } = fakeTools();
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Barbearia do Zé" },
      conversation: [{ direction: "INBOUND", content: "me manda o cardápio completo?" }],
      tools,
    });
    expect(r.toolsUsed.includes("enviar_catalogo") || sent.length > 0).toBe(true);
  }, EVAL_TIMEOUT);

  it("'anota 2 x-burguer e uma coca' → abre comanda com os ids certos", async () => {
    const ai = await loadAi();
    const generateAgenticReply = await loadAgentic();
    const captured: { catalogItemId: string; quantidade?: number }[] = [];
    const tools = [
      {
        name: "consultar_estoque",
        description: "Consulta o catálogo e o estoque ao vivo; devolve o id de cada item.",
        jsonSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string" } } },
        handler: async () => ({
          content: "id=ci_burger | X-Burguer | R$ 25,00 | estoque=—\nid=ci_coca | Coca-Cola | R$ 7,00 | estoque=—",
        }),
      },
      {
        name: "criar_comanda",
        description: "Abre uma comanda e adiciona itens do catálogo (por id de consultar_estoque).",
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            itens: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { catalogItemId: { type: "string" }, quantidade: { type: "number" } },
                required: ["catalogItemId"],
              },
            },
          },
          required: ["itens"],
        },
        handler: async (args: unknown) => {
          const itens = (args as { itens?: { catalogItemId: string; quantidade?: number }[] }).itens ?? [];
          captured.push(...itens);
          return { content: "Comanda aberta: 2× X-Burguer, 1× Coca-Cola — total R$ 57,00" };
        },
      },
    ];
    const r = await generateAgenticReply({
      ai,
      company: { displayName: "Lanchonete do Zé" },
      conversation: [{ direction: "INBOUND", content: "anota aí 2 x-burguer e uma coca, por favor" }],
      tools,
    });
    expect(r.toolsUsed).toContain("criar_comanda");
    const ids = captured.map((i) => i.catalogItemId);
    expect(ids).toContain("ci_burger");
    expect(ids).toContain("ci_coca");
  }, EVAL_TIMEOUT);
});
