import { z } from "zod";

/**
 * Validação central de ambiente (zod).
 *
 * Princípio: só `OPENAI_API_KEY` + `DATABASE_URL` são realmente obrigatórias
 * para rodar o fluxo end-to-end local. Credenciais de WhatsApp/Google só são
 * exigidas quando o modo correspondente sai de "mock". Isso é validado de forma
 * preguiçosa (lazy) nos factories de cada camada, não aqui — para o avaliador
 * conseguir subir o app só com a chave da OpenAI.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  OPENAI_API_KEY: z.string().optional().default(""),
  AI_MODEL_CHEAP: z.string().default("gpt-4o-mini"), // classificação / próxima pergunta (barato)
  AI_MODEL_STRONG: z.string().default("gpt-4o"), // qualificação estruturada / decisões

  WHATSAPP_MODE: z.enum(["mock", "cloud-api", "baileys"]).default("mock"),
  WHATSAPP_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default("meu-verify-token"),

  CALENDAR_MODE: z.enum(["mock", "google-calendar"]).default("mock"),
  GOOGLE_CLIENT_EMAIL: z.string().optional().default(""),
  GOOGLE_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_CALENDAR_ID: z.string().optional().default("primary"),

  SCHEDULING_TIMEZONE: z.string().default("America/Sao_Paulo"),

  // Deliverability / disparo seguro
  WHATSAPP_DAILY_CAP: z.coerce.number().int().positive().default(1000),
  WHATSAPP_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(8000), // ~7,5/min
  WHATSAPP_JITTER_MS: z.coerce.number().int().nonnegative().default(4000),
  WHATSAPP_SEND_START_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  WHATSAPP_SEND_END_HOUR: z.coerce.number().int().min(1).max(24).default(18),
  WHATSAPP_TEMPLATE_NAME: z.string().optional().default(""),
  WHATSAPP_TEMPLATE_LANG: z.string().default("pt_BR"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""), // validação de assinatura do webhook
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),

  // Baileys (transporte não-oficial, multi-número)
  BAILEYS_AUTH_DIR: z.string().default(".baileys-auth"),
  BAILEYS_PER_NUMBER_DAILY_CAP: z.coerce.number().int().positive().default(30), // warm-up conservador por chip
  BAILEYS_ONWHATSAPP_CHECK: z.coerce.boolean().default(true), // pula número sem WhatsApp
  BAILEYS_TYPING_MS_PER_CHAR: z.coerce.number().int().nonnegative().default(55), // simula digitação
  BAILEYS_TYPING_MAX_MS: z.coerce.number().int().positive().default(9000), // teto do "digitando..."
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variáveis de ambiente inválidas:\n${issues}\n\nCopie .env.example para .env e preencha.`,
  );
}

export const env = parsed.data;

/** A IA é real sempre. Esta flag indica se a chave foi configurada. */
export const isAiConfigured = env.OPENAI_API_KEY.length > 0;
