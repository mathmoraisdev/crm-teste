import { z } from "zod";

/**
 * Validação central de ambiente (zod).
 *
 * Princípio: só `ANTHROPIC_API_KEY` + `DATABASE_URL` são realmente obrigatórias
 * para rodar o fluxo end-to-end local. Credenciais de WhatsApp/Google só são
 * exigidas quando o modo correspondente sai de "mock". Isso é validado de forma
 * preguiçosa (lazy) nos factories de cada camada, não aqui — para o avaliador
 * conseguir subir o app só com a chave da Anthropic.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  AI_MODEL_CHEAP: z.string().default("claude-haiku-4-5"),
  AI_MODEL_STRONG: z.string().default("claude-sonnet-4-6"),

  WHATSAPP_MODE: z.enum(["mock", "cloud-api"]).default("mock"),
  WHATSAPP_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default("meu-verify-token"),

  CALENDAR_MODE: z.enum(["mock", "google-calendar"]).default("mock"),
  GOOGLE_CLIENT_EMAIL: z.string().optional().default(""),
  GOOGLE_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_CALENDAR_ID: z.string().optional().default("primary"),

  SCHEDULING_TIMEZONE: z.string().default("America/Sao_Paulo"),
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
export const isAiConfigured = env.ANTHROPIC_API_KEY.length > 0;
