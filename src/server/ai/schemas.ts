import { z } from "zod";

/**
 * Schemas de saída da IA. Mantemos dois espelhos:
 *  - zod  → valida o que voltou do modelo no runtime.
 *  - JSON Schema → vai no `input_schema` da tool (tool-use forçado), garantindo
 *    que o modelo só consiga responder no formato certo.
 */

export const NEXT_ACTIONS = [
  "ask_question",
  "schedule_meeting",
  "send_offer",
  "discard",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

// ── Qualificação (modelo "strong": gpt-4o) ───────────────────────────────
export const qualificationSchema = z.object({
  interestLevel: z.enum(["baixo", "medio", "alto"]).nullable(),
  painPoint: z.string().nullable(),
  segment: z.string().nullable(),
  isDecisionMaker: z.boolean().nullable(),
  urgency: z.enum(["baixa", "media", "alta"]).nullable(),
  budget: z.string().nullable(),
  preferredMeetingTime: z.string().nullable(),
  email: z.string().nullable(),
  score: z.number().min(0).max(100),
  scoreJustification: z.string(),
  summary: z.string(),
  nextAction: z.enum(NEXT_ACTIONS),
  // Oferta escolhida pela IA quando nextAction = "send_offer". Deve ser um id da
  // lista de OFERTAS DISPONÍVEIS; null quando não se aplica. O servidor valida.
  offerId: z.string().nullable().optional(),
});
export type QualificationResult = z.infer<typeof qualificationSchema>;

export const qualificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interestLevel: {
      type: ["string", "null"],
      enum: ["baixo", "medio", "alto", null],
      description: "Nível de interesse percebido do lead.",
    },
    painPoint: {
      type: ["string", "null"],
      description: "Principal dor/necessidade mencionada, se houver.",
    },
    segment: {
      type: ["string", "null"],
      description: "Segmento / ramo de atuação do lead, se identificável.",
    },
    isDecisionMaker: {
      type: ["boolean", "null"],
      description: "Se o lead parece ser tomador de decisão.",
    },
    urgency: {
      type: ["string", "null"],
      enum: ["baixa", "media", "alta", null],
      description: "Urgência da necessidade.",
    },
    budget: {
      type: ["string", "null"],
      description: "Indicação de orçamento/verba, se mencionada.",
    },
    preferredMeetingTime: {
      type: ["string", "null"],
      description: "Preferência de horário citada em texto livre, se houver.",
    },
    email: {
      type: ["string", "null"],
      description:
        "E-mail do lead, SE ele informou em algum momento da conversa. null se não mencionado. Nunca invente.",
    },
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description:
        "Score de qualificação 0–100. >=70 qualifica; <40 com desinteresse = descarte.",
    },
    scoreJustification: {
      type: "string",
      description:
        "Justificativa curta (1 frase) focada em vendas que explica o score atribuído, baseada nos últimos turnos da conversa. Exemplos: 'O lead demonstrou urgência na compra e confirmou ser o decisor.', 'Lead sem dor identificada e sem engajamento com as perguntas.', 'Interesse alto, mas orçamento ainda não confirmado.'",
    },
    summary: {
      type: "string",
      description: "Resumo curto (1–2 frases) da situação do lead.",
    },
    nextAction: {
      type: "string",
      enum: NEXT_ACTIONS,
      description:
        "ask_question = continuar qualificando; schedule_meeting = pronto para agendar; send_offer = intenção de compra clara, apresentar oferta e cobrar; discard = lead sem fit/desinteressado.",
    },
    offerId: {
      type: ["string", "null"],
      description:
        "Quando nextAction = send_offer, o id da oferta escolhida ENTRE as listadas em OFERTAS DISPONÍVEIS. Nunca invente um id nem informe preço. null nas demais ações.",
    },
  },
  required: [
    "interestLevel",
    "painPoint",
    "segment",
    "isDecisionMaker",
    "urgency",
    "budget",
    "preferredMeetingTime",
    "email",
    "score",
    "scoreJustification",
    "summary",
    "nextAction",
    "offerId",
  ],
} as const;

// ── Interpretação da escolha de horário (modelo "cheap": gpt-4o-mini) ─────
export const slotChoiceSchema = z.object({
  chosenIndex: z.number().int().nullable(),
  confident: z.boolean(),
  // Preferência de OUTRO horário (o lead não quer nenhum dos oferecidos e pediu
  // um dia/hora diferente): ISO 8601 aproximado no fuso da conta, ou null.
  preferredStartIso: z.string().nullable().optional().default(null),
});
export type SlotChoice = z.infer<typeof slotChoiceSchema>;

export const slotChoiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chosenIndex: {
      type: ["integer", "null"],
      description:
        "Índice (base 0) do horário escolhido pelo lead, ou null se ele não escolheu nenhum dos oferecidos.",
    },
    confident: {
      type: "boolean",
      description: "Se há confiança razoável na escolha identificada.",
    },
    preferredStartIso: {
      type: ["string", "null"],
      description:
        "Se o lead NÃO escolheu nenhum dos horários e pediu um dia/hora DIFERENTE " +
        "(ex.: 'semana que vem', 'amanhã 14h', 'quinta de manhã'), calcule a data/hora " +
        "aproximada com base na data atual informada e retorne em ISO 8601 (ex.: " +
        "2026-07-15T14:00:00). Sem preferência nova → null.",
    },
  },
  required: ["chosenIndex", "confident", "preferredStartIso"],
} as const;

// ── Interpretação da resposta a um lembrete de agendamento (modelo "cheap") ──
export const APPT_REPLY_INTENTS = ["confirm", "decline", "reschedule", "unclear"] as const;
export type ApptReplyIntent = (typeof APPT_REPLY_INTENTS)[number];

export const apptReplySchema = z.object({
  intent: z.enum(APPT_REPLY_INTENTS),
  confident: z.boolean(),
});
export type ApptReply = z.infer<typeof apptReplySchema>;

export const apptReplyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: APPT_REPLY_INTENTS,
      description:
        "confirm = cliente confirma que vem; decline = não vem / quer cancelar; reschedule = quer remarcar para outra data; unclear = não deu para entender ou fala de outro assunto.",
    },
    confident: {
      type: "boolean",
      description: "Se há confiança razoável na classificação.",
    },
  },
  required: ["intent", "confident"],
} as const;
