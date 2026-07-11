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
  // Timeout por requisição aos SDKs de IA (OpenAI/Anthropic/transcrição). Os SDKs
  // usam ~10min de default: uma chamada pendurada trava a conversa inteira (a
  // resposta reativa faz várias chamadas em série). 45s falha rápido e ainda dá
  // folga p/ o modelo strong. AI_MAX_RETRIES é o teto de retentativas (SDK usa 2):
  // com backoff, 2 retries + 45s/tentativa ≈ ~2min no pior caso, vs ~13min hoje.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  // Kill-switch global do loop de tools (IA com ações). true desliga o caminho
  // agêntico em TODOS os números, independente da flag por número — p/ apagar
  // incêndio em prod sem tocar no banco. Default false = respeita a flag do número.
  AI_TOOLCALLING_DISABLED: z.coerce.boolean().default(false),

  // Chave mestra p/ cifrar credenciais de IA dos usuários (BYOK). 64 hex = 32 bytes.
  // Opcional p/ não quebrar build/avaliador; o factory de crypto exige em runtime.
  ENCRYPTION_KEY: z.string().optional().default(""),

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
  WHATSAPP_DAILY_CAP: z.coerce.number().int().nonnegative().default(0), // 0 = ilimitado (modo massa); cap agora é por conta
  // Teto diário de disparo para contas SEM pagamento lançado (trial/cortesia).
  // Cap normal segue em WHATSAPP_DAILY_CAP. 0 = desliga (trial usa o cap normal).
  TRIAL_WHATSAPP_DAILY_CAP: z.coerce.number().int().nonnegative().default(30),
  WHATSAPP_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(8000), // ~7,5/min
  WHATSAPP_JITTER_MS: z.coerce.number().int().nonnegative().default(4000),
  WHATSAPP_SEND_START_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  WHATSAPP_SEND_END_HOUR: z.coerce.number().int().min(1).max(24).default(18),
  WHATSAPP_TEMPLATE_NAME: z.string().optional().default(""),
  WHATSAPP_TEMPLATE_LANG: z.string().default("pt_BR"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""), // validação de assinatura do webhook
  // LGPD: rodapé de descadastro anexado ao outbound frio (campanhas). A palavra
  // "SAIR" casa com o detector de opt-out inbound. Desligável p/ template aprovado.
  OUTBOUND_OPTOUT_FOOTER: z.coerce.boolean().default(true),
  OUTBOUND_OPTOUT_FOOTER_TEXT: z.string().default("Responda SAIR para não receber mais mensagens."),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(120_000), // job SENDING órfão > isto volta à fila
  WORKER_REAP_EVERY_MS: z.coerce.number().int().positive().default(30_000), // frequência do reaper
  WORKER_MAX_DEFERS: z.coerce.number().int().positive().default(5), // deferimentos sem chip antes de pausar campanha
  WORKER_HEARTBEAT_STALE_MS: z.coerce.number().int().positive().default(120_000), // sem heartbeat acima disto = worker offline
  // Modo massa (risco assumido): ritmo por chip. min<=0 dispara sem pausa.
  MASS_PER_CHIP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1500),
  MASS_PER_CHIP_JITTER_MS: z.coerce.number().int().nonnegative().default(1500),

  // Cron de disparo (alternativa serverless ao worker; protege a rota /api/cron/dispatch).
  // A Vercel Cron envia este valor como `Authorization: Bearer <CRON_SECRET>`.
  CRON_SECRET: z.string().optional().default(""),

  // Baileys (transporte não-oficial, multi-número)
  BAILEYS_AUTH_DIR: z.string().default(".baileys-auth"),
  // Onde persistir o auth-state dos chips. "db" (default) sobrevive a redeploys
  // do Railway (disco efêmero) gravando na tabela WhatsAppAuthState; "file"
  // mantém o comportamento antigo (useMultiFileAuthState em BAILEYS_AUTH_DIR).
  BAILEYS_AUTH_STORE: z.enum(["db", "file"]).default("db"),
  BAILEYS_PER_NUMBER_DAILY_CAP: z.coerce.number().int().positive().default(100000), // modo massa: default solto (baixe na UI p/ warm-up)
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

  // Supabase Storage — guarda mídia recebida do lead (imagem/PDF) em bucket
  // PRIVADO; o binário nunca vai pro Postgres. Opcionais: sem elas, a mídia
  // segue só como placeholder no inbox (degradação segura, igual hoje).
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""), // chave de serviço (server-only)
  SUPABASE_MEDIA_BUCKET: z.string().default("whatsapp-media"),
  SUPABASE_BRANDING_BUCKET: z.string().default("branding"),
  // Retenção de mídia: apaga o BINÁRIO do Storage após N dias. A Message e a
  // transcrição de áudio (em `content`) PERMANECEM — o inbox só cai no placeholder
  // ("🎤 Áudio"), caminho que o sistema já trata por degradação segura. 0 =
  // desligado (nunca apaga): default seguro p/ subir inerte e ligar por env em
  // prod. Recomendado quando ligar: 180 (imagem/PDF) + 30 no áudio (já virou texto).
  MEDIA_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  MEDIA_AUDIO_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0), // 0 = usa MEDIA_RETENTION_DAYS
  MEDIA_RETENTION_EVERY_MS: z.coerce.number().int().positive().default(21_600_000), // 6h: granularidade é dia
  // Retenção do log de auditoria (Tier 1). Poda no worker as linhas AuditLog mais
  // velhas que N dias. Default 90 (~3 meses) — LIGADO por padrão (o log não deve
  // crescer p/ sempre; dúvida/briga aparece no mês vigente + folga). 0 desliga
  // (nunca poda). Custo é só storage, zero Upstash.
  AUDIT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),
  // Automação de ciclo de vida (pós-venda, NPS, reengajamento de frio). Roda no
  // worker. LIFECYCLE_AUTOMATION é o KILL-SWITCH global: false = nada dispara
  // (sobe inerte, igual MEDIA_RETENTION_DAYS). Cada toque liga pelo seu atraso
  // (0 = desligado). O opt-in POR CONTA (User.lifecycleAutomationEnabled) é a 2ª
  // chave — as duas precisam estar ligadas. Recomendado ao ligar: postsale 2,
  // review 24, reengage 7.
  LIFECYCLE_AUTOMATION: z.coerce.boolean().default(false),
  LIFECYCLE_POSTSALE_HOURS: z.coerce.number().int().nonnegative().default(0), // 0 = off; rec 2
  LIFECYCLE_REVIEW_HOURS: z.coerce.number().int().nonnegative().default(0), // 0 = off; rec 24
  LIFECYCLE_REENGAGE_DAYS: z.coerce.number().int().nonnegative().default(0), // 0 = off; rec 7
  LIFECYCLE_BACKLOG_FLOOR_DAYS: z.coerce.number().int().positive().default(7), // não tocar eventos + antigos ao ligar
  LIFECYCLE_EVERY_MS: z.coerce.number().int().positive().default(900_000), // 15 min: granularidade é hora/dia
  // Dias de teste grátis para cadastros novos. Padrão 0 = nasce SUSPENSO (sem
  // trial automático); o admin libera o teste manualmente no /financeiro.
  TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(0),

  // ── Funil de vendas / cobrança Pix (BYOK de pagamento) ──────────────────────
  // Base URLs dos gateways (default sandbox no Asaas, prod no Mercado Pago).
  ASAAS_BASE_URL: z.string().default("https://api-sandbox.asaas.com"),
  MERCADOPAGO_BASE_URL: z.string().default("https://api.mercadopago.com"),
  PAGBANK_BASE_URL: z.string().default("https://sandbox.api.pagseguro.com"),
  // Base pública do app p/ montar a notification_url dos webhooks de pagamento.
  APP_PUBLIC_URL: z.string().default("http://localhost:3000"),

  // ── Fiscal (NFC-e via emissor terceiro, Onda H) ─────────────────────────────
  // FISCAL_EMISSION é o KILL-SWITCH global: false = nada é emitido (sobe inerte).
  // A 2ª chave é o opt-in por conta (User.fiscalEnabled). As duas precisam estar
  // ligadas. FISCAL_MOCK usa o emissor determinístico sem tocar SEFAZ (dev/teste).
  FISCAL_MOCK: z.coerce.boolean().default(false),
  FISCAL_EMISSION: z.coerce.boolean().default(false),
  FISCAL_EVERY_MS: z.coerce.number().int().positive().default(60_000), // 1 min: SEFAZ é lento
  FISCAL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // ── Transcrição de áudio (fala→texto) — chave SEMPRE de plataforma ──────────
  TRANSCRIBE_ENABLED: z.coerce.boolean().default(false),
  TRANSCRIBE_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
  GROQ_API_KEY: z.string().optional().default(""),
  TRANSCRIBE_MODEL_GROQ: z.string().default("whisper-large-v3-turbo"),
  TRANSCRIBE_MODEL_OPENAI: z.string().default("whisper-1"),
  TRANSCRIBE_MAX_SECONDS: z.coerce.number().int().positive().default(300), // 5 min
  TRANSCRIBE_MAX_CHARS: z.coerce.number().int().positive().default(1200), // truncagem p/ contexto da IA

  // ── Auto-sugerir nome por código de barras (EAN) ────────────────────────────
  // Kill-switch: EAN_LOOKUP_DISABLED=true desliga tudo (default false = ligado).
  // Idioma da casa (igual AI_TOOLCALLING_DISABLED) — evita a pegadinha de
  // z.coerce.boolean() com default true (lá "false" coage p/ true e não desliga).
  // ⚠️ NÃO setar =false p/ "ligar": qualquer valor não-vazio vira true. Deixe
  // AUSENTE p/ manter ligado. Sem COSMOS_API_TOKEN → usa só o Open Food Facts
  // (grátis, alimento/bebida). Tudo fail-open: erro/timeout NUNCA trava o cadastro.
  EAN_LOOKUP_DISABLED: z.coerce.boolean().default(false),
  COSMOS_BASE_URL: z.string().default("https://api.cosmos.bluesoft.com.br"),
  COSMOS_API_TOKEN: z.string().optional().default(""),
  // DotCompany: provedor grátis adicional (sem chave, ~25/dia POR IP — conta até
  // erros; na Vercel o IP é compartilhado, então é bônus best-effort). Honesta no
  // "não achei" (sucesso:false). DOTCOMPANY_DISABLED=true desliga (idioma da casa).
  DOTCOMPANY_DISABLED: z.coerce.boolean().default(false),
  DOTCOMPANY_BASE_URL: z.string().default("https://erp.dotcompany.com.br"),
  EAN_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(4000), // cadastro é interativo: falha rápido
  EAN_NEGATIVE_TTL_DAYS: z.coerce.number().int().positive().default(30), // recheca "não achou" após N dias
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

/** BYOK exige a chave mestra de 32 bytes (64 hex). */
export const isEncryptionConfigured = /^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY);

/** Storage de mídia (Supabase) só liga com URL + service role. Sem elas, a mídia
 *  recebida do lead continua virando apenas placeholder no inbox (sem download). */
export const isMediaStorageConfigured =
  env.SUPABASE_URL.length > 0 && env.SUPABASE_SERVICE_ROLE_KEY.length > 0;
