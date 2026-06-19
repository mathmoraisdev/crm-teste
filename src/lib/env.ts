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
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(120_000), // job SENDING órfão > isto volta à fila
  WORKER_REAP_EVERY_MS: z.coerce.number().int().positive().default(30_000), // frequência do reaper

  // Cron de disparo (alternativa serverless ao worker; protege a rota /api/cron/dispatch).
  // A Vercel Cron envia este valor como `Authorization: Bearer <CRON_SECRET>`.
  CRON_SECRET: z.string().optional().default(""),

  // Baileys (transporte não-oficial, multi-número)
  BAILEYS_AUTH_DIR: z.string().default(".baileys-auth"),
  // Onde persistir o auth-state dos chips. "db" (default) sobrevive a redeploys
  // do Railway (disco efêmero) gravando na tabela WhatsAppAuthState; "file"
  // mantém o comportamento antigo (useMultiFileAuthState em BAILEYS_AUTH_DIR).
  BAILEYS_AUTH_STORE: z.enum(["db", "file"]).default("db"),
  BAILEYS_PER_NUMBER_DAILY_CAP: z.coerce.number().int().positive().default(30), // warm-up conservador por chip
  BAILEYS_ONWHATSAPP_CHECK: z.coerce.boolean().default(true), // pula número sem WhatsApp
  BAILEYS_TYPING_MS_PER_CHAR: z.coerce.number().int().nonnegative().default(55), // simula digitação
  BAILEYS_TYPING_MAX_MS: z.coerce.number().int().positive().default(9000), // teto do "digitando..."

  // App / e-mail transacional / consultor / admin / observabilidade.
  // Todas opcionais com default seguro: o build nunca quebra sem elas.
  APP_URL: z.string().default("http://localhost:3000"), // base p/ links em e-mails
  EMAIL_FROM: z.string().optional().default(""), // remetente dos e-mails (Resend)
  RESEND_API_KEY: z.string().optional().default(""), // chave da Resend (sem ela, e-mail vira console.info)
  CONSULTANT_WHATSAPP: z.string().optional().default(""), // número que recebe leads do consultor
  ADMIN_EMAILS: z.string().optional().default(""), // e-mails admin (separados por vírgula)
  SENTRY_DSN: z.string().optional().default(""), // DSN do Sentry (server-side)
});

/**
 * Durante o `next build` (passo "Collecting page data") o Next executa o código
 * de nível de módulo de cada rota — o que importa este arquivo e dispara a
 * validação. Nesse momento as variáveis de runtime podem não existir (ex.: deploy
 * de Preview na Vercel onde DATABASE_URL não foi exposta ao build). Não queremos
 * derrubar o build por isso: nada conecta ao banco durante a coleta (o Prisma só
 * conecta na primeira query, e nenhum handler roda aqui). A validação fail-fast
 * continua valendo em runtime, onde NEXT_PHASE/npm_lifecycle_event não batem.
 */
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const parsed = schema.safeParse(process.env);

if (!parsed.success && !isBuildPhase) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variáveis de ambiente inválidas:\n${issues}\n\nCopie .env.example para .env e preencha.`,
  );
}

// Em build sem as envs, usa um placeholder só para o módulo carregar — nada
// conecta com essa URL porque nenhuma query roda durante o build.
export const env = parsed.success
  ? parsed.data
  : schema.parse({
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://build:build@localhost:5432/build?schema=public",
    });

/** A IA é real sempre. Esta flag indica se a chave foi configurada. */
export const isAiConfigured = env.OPENAI_API_KEY.length > 0;
