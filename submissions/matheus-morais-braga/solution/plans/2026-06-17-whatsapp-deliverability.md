# Camada de Deliverability WhatsApp (Caminho A — Cloud API) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` para implementar este plano tarefa-a-tarefa.

**Goal:** Tornar o disparo de campanhas seguro e sustentável a ~1.000 mensagens/dia via WhatsApp Cloud API oficial, sem o número cair — adicionando fila, rate limiting, janela de envio, warm-up (cap diário), opt-out automático, templates aprovados e monitoramento de qualidade.

**Architecture:** O disparo deixa de ser um loop síncrono em `startCampaign` e passa a **enfileirar** um `OutboundJob` por lead numa tabela Postgres. Um **worker** (processo `tsx` separado) consome a fila respeitando intervalo mínimo + jitter, janela de horário comercial e cap diário, pulando leads em opt-out e pausando se a campanha estiver `PAUSED` (gate de qualidade). O cold outbound usa **template aprovado**; as respostas dentro da janela de 24h continuam em texto livre pelo caminho reativo já existente. O webhook passa a processar `statuses` (delivered/read/failed) e atualizações de qualidade do número.

**Tech Stack:** Next.js 15 (App Router), Prisma + Postgres, TypeScript, vitest (test runner), tsx (worker/scripts), WhatsApp Cloud API (Graph API via `fetch`).

**Princípios:** DRY, YAGNI, TDD nas partes de lógica pura, checkpoints frequentes.

---

## Convenções deste plano

- **Test runner:** vitest. Rodar um arquivo: `npx vitest run src/caminho/arquivo.test.ts`. Toda a suíte: `npm test`.
- **Tipos do Prisma:** após editar `schema.prisma`, sempre `npm run db:push && npm run db:generate` antes de usar os novos modelos no TS (senão o tipo não existe).
- **Commits = checkpoints.** Este repo ainda **não é git** — ver Tarefa 0. Se optar por não usar git, trate cada "Commit" como um ponto de parada/validação.
- **Lógica pura primeiro (TDD):** opt-out, janela de envio e cap diário são funções puras e testáveis — implementadas via teste-que-falha → implementação mínima → teste-que-passa.
- **Não quebrar o modo mock.** Tudo deve continuar rodando com `WHATSAPP_MODE=mock` localmente (o worker e a fila funcionam em mock também, logando em vez de chamar a Graph API).

---

## Tarefa 0: Setup (git + branch de trabalho)

**Step 1: Inicializar git (se ainda não houver)**

Run:
```bash
git init && git add -A && git commit -m "chore: snapshot inicial antes da camada de deliverability"
```
Expected: repositório criado, primeiro commit com o estado atual do app.

> Se o usuário não quiser git, pule esta tarefa e ignore os passos "Commit" adiante.

---

## Tarefa 1: Schema — opt-out, consentimento, fila e status PAUSED

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Adicionar enum de status de job e de PAUSED na campanha**

Em `prisma/schema.prisma`, adicione o status `PAUSED` ao enum existente e um novo enum:

```prisma
enum CampaignStatus {
  DRAFT
  RUNNING
  PAUSED        // pausada pelo gate de qualidade
  COMPLETED
}

enum OutboundJobStatus {
  PENDING       // aguardando o worker
  SENDING       // travado por um worker (evita envio duplo)
  SENT          // enviado com sucesso
  FAILED        // falhou após retries
  CANCELLED     // lead deu opt-out / campanha cancelada
}
```

**Step 2: Adicionar campos de opt-out/consentimento ao Lead e a back-relation da fila**

No `model Lead`, adicione:

```prisma
  optOut        Boolean        @default(false)
  optOutAt      DateTime?
  consentSource String?        // origem do opt-in (LGPD)
  outboundJobs  OutboundJob[]
```

**Step 3: Adicionar a back-relation e o cap diário na Campaign**

No `model Campaign`, adicione:

```prisma
  dailyCap     Int?          // teto diário p/ warm-up (null = usa default do env)
  outboundJobs OutboundJob[]
```

**Step 4: Criar o model OutboundJob**

Adicione ao final do schema:

```prisma
model OutboundJob {
  id           String            @id @default(cuid())
  lead         Lead              @relation(fields: [leadId], references: [id], onDelete: Cascade)
  leadId       String
  campaign     Campaign?         @relation(fields: [campaignId], references: [id])
  campaignId   String?
  kind         String            // "template" | "freeform"
  content      String            // texto renderizado (auditoria / freeform)
  templateName String?           // nome do template aprovado (quando kind=template)
  status       OutboundJobStatus @default(PENDING)
  attempts     Int               @default(0)
  lastError    String?
  scheduledFor DateTime          @default(now())
  sentAt       DateTime?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@index([status, scheduledFor])
  @@index([leadId])
  @@index([campaignId])
}
```

**Step 5: Aplicar o schema e regenerar o client**

Run:
```bash
npm run db:push && npm run db:generate
```
Expected: "Your database is now in sync with your Prisma schema" e o client regenerado sem erros.

**Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): opt-out, consentimento, fila OutboundJob e status PAUSED"
```

---

## Tarefa 2: Detecção de opt-out (lógica pura, TDD)

**Files:**
- Create: `src/lib/optout.ts`
- Test: `src/lib/optout.test.ts`

**Step 1: Escrever o teste que falha**

`src/lib/optout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isOptOut } from "./optout";

describe("isOptOut", () => {
  it("detecta palavras-chave isoladas, sem acento e case-insensitive", () => {
    for (const t of ["PARAR", "parar", "Sair", "stop", "cancelar", "descadastrar", "remover"]) {
      expect(isOptOut(t)).toBe(true);
    }
  });

  it("detecta palavra-chave dentro de uma frase curta", () => {
    expect(isOptOut("quero parar de receber")).toBe(true);
    expect(isOptOut("PARE de me mandar mensagem")).toBe(true);
    expect(isOptOut("não quero mais")).toBe(true);
  });

  it("não confunde mensagens normais com opt-out", () => {
    expect(isOptOut("olá, quero saber mais")).toBe(false);
    expect(isOptOut("pode me ligar amanhã?")).toBe(false);
    expect(isOptOut("comparar os planos")).toBe(false); // contém "parar" como substring → NÃO é opt-out
  });
});
```

**Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/optout.test.ts`
Expected: FAIL — "isOptOut is not a function".

**Step 3: Implementar o mínimo**

`src/lib/optout.ts`:

```ts
/**
 * Detecção de opt-out em mensagens inbound. Defesa nº 1 contra denúncias
 * (o que mais derruba a qualidade do número). Casamento por palavra inteira,
 * normalizado (sem acento, minúsculo), para não disparar em substrings
 * (ex.: "comparar" contém "parar" mas NÃO é opt-out).
 */
const OPT_OUT_KEYWORDS = [
  "parar", "pare", "sair", "stop", "cancelar", "cancela",
  "descadastrar", "remover", "remova", "sigam",
];

// frases multi-palavra tratadas à parte
const OPT_OUT_PHRASES = ["nao quero mais", "nao quero", "para de", "pare de"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // remove acentos
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // pontuação → espaço
    .trim();
}

export function isOptOut(text: string): boolean {
  const norm = normalize(text);
  if (OPT_OUT_PHRASES.some((p) => norm.includes(p))) return true;
  const tokens = new Set(norm.split(/\s+/));
  return OPT_OUT_KEYWORDS.some((k) => tokens.has(k));
}
```

**Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/optout.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add src/lib/optout.ts src/lib/optout.test.ts
git commit -m "feat(deliverability): detecção de opt-out (palavra inteira, normalizada)"
```

---

## Tarefa 3: Janela de envio + cálculo do próximo horário (lógica pura, TDD)

**Files:**
- Create: `src/lib/sendWindow.ts`
- Test: `src/lib/sendWindow.test.ts`

> **Sobre fuso:** a função recebe a "hora local" já resolvida (`hourInTz`), para ser determinística no teste. O worker calcula `hourInTz(now, SCHEDULING_TIMEZONE)` via `Intl.DateTimeFormat`. Documente que o processo do worker deve idealmente rodar com `TZ` coerente.

**Step 1: Escrever o teste que falha**

`src/lib/sendWindow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hourInTz, isWithinWindow } from "./sendWindow";

describe("isWithinWindow", () => {
  const opts = { startHour: 9, endHour: 18 };
  it("aceita horário dentro da janela comercial", () => {
    expect(isWithinWindow(9, opts)).toBe(true);
    expect(isWithinWindow(17, opts)).toBe(true);
  });
  it("rejeita antes do início e a partir do fim", () => {
    expect(isWithinWindow(8, opts)).toBe(false);
    expect(isWithinWindow(18, opts)).toBe(false);
    expect(isWithinWindow(23, opts)).toBe(false);
  });
});

describe("hourInTz", () => {
  it("extrai a hora no fuso informado de forma determinística", () => {
    // 2026-06-17T12:00:00Z → 09:00 em America/Sao_Paulo (UTC-3)
    const d = new Date("2026-06-17T12:00:00Z");
    expect(hourInTz(d, "America/Sao_Paulo")).toBe(9);
  });
});
```

**Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/sendWindow.test.ts`
Expected: FAIL — funções não definidas.

**Step 3: Implementar o mínimo**

`src/lib/sendWindow.ts`:

```ts
/** Hora (0–23) de uma data num fuso específico, via Intl (determinístico). */
export function hourInTz(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return parseInt(h, 10) % 24;
}

export interface WindowOpts {
  startHour: number; // inclusivo
  endHour: number;   // exclusivo
}

/** A hora informada está dentro da janela [startHour, endHour)? */
export function isWithinWindow(hour: number, opts: WindowOpts): boolean {
  return hour >= opts.startHour && hour < opts.endHour;
}

/** Jitter aleatório em ms (NÃO testado — usado só no worker p/ humanizar o ritmo). */
export function jitterMs(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}
```

**Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/sendWindow.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/sendWindow.ts src/lib/sendWindow.test.ts
git commit -m "feat(deliverability): janela de envio comercial + hora por fuso"
```

---

## Tarefa 4: Novas variáveis de ambiente

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

**Step 1: Adicionar as vars ao schema zod**

Em `src/lib/env.ts`, dentro do `z.object({...})`, adicione (todas com default — não quebram o mock):

```ts
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
```

**Step 2: Documentar no .env.example**

Acrescente ao final de `.env.example`:

```
# ─────────────────────────────────────────────────────────────
# Deliverability — disparo seguro (Caminho A / Cloud API)
# ─────────────────────────────────────────────────────────────
WHATSAPP_DAILY_CAP="1000"          # teto diário (começar baixo no warm-up!)
WHATSAPP_MIN_INTERVAL_MS="8000"    # intervalo mínimo entre envios
WHATSAPP_JITTER_MS="4000"          # variação aleatória somada ao intervalo
WHATSAPP_SEND_START_HOUR="9"       # início da janela comercial
WHATSAPP_SEND_END_HOUR="18"        # fim (exclusivo) da janela
WHATSAPP_TEMPLATE_NAME=""          # nome do template aprovado p/ cold outbound
WHATSAPP_TEMPLATE_LANG="pt_BR"
WHATSAPP_APP_SECRET=""             # App Secret p/ validar assinatura do webhook
WORKER_POLL_MS="2000"              # frequência de polling do worker
```

**Step 3: Validar que o app ainda sobe**

Run: `npx tsx -e "import('./src/lib/env.ts').then(()=>console.log('env ok'))"`
Expected: "env ok" (defaults aplicados, nada obrigatório novo).

**Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(config): env de rate limit, janela, template e cap diário"
```

---

## Tarefa 5: Template no WhatsAppService (cold outbound)

**Files:**
- Modify: `src/server/whatsapp/types.ts`
- Modify: `src/server/whatsapp/cloud-api.ts`
- Modify: `src/server/whatsapp/mock.ts`

**Step 1: Estender a interface**

Em `src/server/whatsapp/types.ts`, adicione ao `WhatsAppService`:

```ts
  /**
   * Envia um template aprovado (obrigatório p/ mensagem ativa fora da janela 24h).
   * `variables` preenche os {{1}}, {{2}}... do corpo do template, na ordem.
   */
  sendTemplate(
    to: string,
    templateName: string,
    lang: string,
    variables: string[],
  ): Promise<WhatsAppSendResult>;
```

**Step 2: Implementar no cloud-api**

Em `src/server/whatsapp/cloud-api.ts`, adicione o método ao objeto retornado (após `sendMessage`):

```ts
    async sendTemplate(to, templateName, lang, variables) {
      const components =
        variables.length > 0
          ? [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ]
          : [];
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/^\+/, ""),
          type: "template",
          template: {
            name: templateName,
            language: { code: lang },
            components,
          },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp Cloud API (template) ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { messages?: { id: string }[] };
      return { providerMessageId: data.messages?.[0]?.id ?? `cloud-tpl-${Date.now()}` };
    },
```

**Step 3: Implementar no mock**

Em `src/server/whatsapp/mock.ts`, adicione ao objeto retornado:

```ts
    async sendTemplate(to, templateName, lang, variables) {
      const providerMessageId = `mock-tpl-${Date.now()}-${++counter}`;
      console.log(
        `[whatsapp:mock] → ${to} [template:${templateName}/${lang}] vars=${JSON.stringify(variables)}`,
      );
      return { providerMessageId };
    },
```

**Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (ambas as implementações satisfazem a interface).

**Step 5: Commit**

```bash
git add src/server/whatsapp/
git commit -m "feat(whatsapp): envio de template aprovado (cold outbound)"
```

---

## Tarefa 6: messaging — persistência de OUTBOUND via job + opt-out guard

**Files:**
- Modify: `src/server/services/messaging.ts`
- Test: `src/server/services/messaging.test.ts` (mock do prisma e do whatsapp)

**Step 1: Estender messaging com `sendOutboundJob` e proteção de opt-out**

Em `src/server/services/messaging.ts`, adicione (mantendo `sendWhatsAppMessage` para o caminho reativo de respostas dentro da janela 24h):

```ts
import { env } from "@/lib/env";
import { renderTemplate } from "./campaign.service";

/**
 * Executa um OutboundJob: respeita opt-out, escolhe template (cold) vs texto
 * (freeform/janela 24h), envia, persiste OUTBOUND e move o lead p/ CONTATADO.
 * Lança em falha (o worker trata retry/erro).
 */
export async function dispatchOutboundJob(jobId: string): Promise<void> {
  const job = await prisma.outboundJob.findUnique({
    where: { id: jobId },
    include: { lead: { select: { id: true, name: true, phone: true, optOut: true } } },
  });
  if (!job || !job.lead) return;
  if (job.lead.optOut) {
    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", lastError: "lead em opt-out" },
    });
    return;
  }

  const wa = getWhatsApp();
  const { lead } = job;
  let providerMessageId: string;

  if (job.kind === "template" && env.WHATSAPP_TEMPLATE_NAME && wa.mode === "cloud-api") {
    const res = await wa.sendTemplate(
      lead.phone,
      job.templateName || env.WHATSAPP_TEMPLATE_NAME,
      env.WHATSAPP_TEMPLATE_LANG,
      [lead.name],
    );
    providerMessageId = res.providerMessageId;
  } else {
    // mock OU freeform: usa o conteúdo já renderizado
    const res = await wa.sendMessage(lead.phone, job.content);
    providerMessageId = res.providerMessageId;
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: job.content,
        providerMessageId,
        status: "SENT",
      },
    }),
    prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt: new Date() },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: { status: "CONTATADO", updatedAt: new Date() },
    }),
  ]);
}
```

> Nota: `renderTemplate` é reusado de `campaign.service` (DRY). Se causar import circular, mova `renderTemplate` para `src/lib/template.ts` e importe dos dois lados.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Se houver import circular `messaging ↔ campaign.service`, aplique a nota acima e re-rode.)

**Step 3: Commit**

```bash
git add src/server/services/messaging.ts src/lib/template.ts 2>/dev/null; git add -A
git commit -m "feat(deliverability): dispatchOutboundJob com guard de opt-out e template"
```

---

## Tarefa 7: startCampaign passa a ENFILEIRAR (não envia mais síncrono)

**Files:**
- Modify: `src/server/services/campaign.service.ts`
- Modify: `src/app/api/campaigns/[id]/start/route.ts` (mensagem de retorno)
- Test: `src/server/services/campaign.enqueue.test.ts`

**Step 1: Reescrever `startCampaign` para criar OutboundJobs**

Substitua o corpo de `startCampaign` por uma versão que **enfileira** e **não** dispara em loop:

```ts
export async function startCampaign(
  campaignId: string,
): Promise<{ enqueued: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      leads: {
        where: { status: "NOVO", optOut: false },
        select: { id: true, name: true },
      },
    },
  });
  if (!campaign) throw new Error("Campanha não encontrada");

  const useTemplate = !!env.WHATSAPP_TEMPLATE_NAME && env.WHATSAPP_MODE === "cloud-api";

  await prisma.$transaction([
    prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } }),
    prisma.outboundJob.createMany({
      data: campaign.leads.map((lead) => ({
        leadId: lead.id,
        campaignId,
        kind: useTemplate ? "template" : "freeform",
        content: renderTemplate(campaign.messageTemplate, lead.name),
        templateName: useTemplate ? env.WHATSAPP_TEMPLATE_NAME : null,
      })),
    }),
  ]);

  return { enqueued: campaign.leads.length };
}
```

Adicione `import { env } from "@/lib/env";` no topo do arquivo.

**Step 2: Atualizar a rota /start para refletir o novo retorno**

Em `src/app/api/campaigns/[id]/start/route.ts` o `result` agora é `{ enqueued }` — nenhuma mudança estrutural necessária, mas confirme que a UI não depende de `{ sent, skipped }`. Se depender, ajuste o componente que consome (procure por `.sent`/`.skipped`).

**Step 3: Teste de enfileiramento**

`src/server/services/campaign.enqueue.test.ts` — mocka o prisma e verifica que `startCampaign` cria N jobs PENDING e marca a campanha RUNNING (não chama whatsapp). Estruture o mock no padrão dos testes existentes do projeto.

Run: `npx vitest run src/server/services/campaign.enqueue.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(campaign): startCampaign enfileira OutboundJobs (sem disparo síncrono)"
```

---

## Tarefa 8: Worker de disparo (fila → rate limit → janela → cap)

**Files:**
- Create: `src/server/worker/dispatcher.ts` (lógica de pegar 1 job e enviar)
- Create: `src/server/worker/run.ts` (loop runnable)
- Modify: `package.json` (script `worker`)

**Step 1: `dispatcher.ts` — pegar o próximo job com lock atômico**

```ts
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { dispatchOutboundJob } from "@/server/services/messaging";

/** Conta quantos jobs já foram enviados hoje (cap diário / warm-up). */
export async function sentToday(now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outboundJob.count({
    where: { status: "SENT", sentAt: { gte: start } },
  });
}

/**
 * Reserva atomicamente 1 job PENDING (status → SENDING via updateMany com guarda)
 * de uma campanha que NÃO esteja pausada, e o processa. Retorna true se enviou.
 */
export async function processNextJob(now: Date): Promise<boolean> {
  const candidate = await prisma.outboundJob.findFirst({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      OR: [{ campaignId: null }, { campaign: { status: { not: "PAUSED" } } }],
    },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  if (!candidate) return false;

  // Lock otimista: só "ganha" o job quem conseguir mudar PENDING→SENDING.
  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claim.count === 0) return false; // outro worker pegou

  try {
    await dispatchOutboundJob(candidate.id);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const job = await prisma.outboundJob.findUnique({
      where: { id: candidate.id },
      select: { attempts: true },
    });
    const failed = (job?.attempts ?? 99) >= 3;
    await prisma.outboundJob.update({
      where: { id: candidate.id },
      data: failed
        ? { status: "FAILED", lastError: msg }
        : { status: "PENDING", lastError: msg, scheduledFor: new Date(now.getTime() + 60_000) },
    });
    return false;
  }
}
```

**Step 2: `run.ts` — loop com rate limit, janela e cap**

```ts
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, sentToday } from "./dispatcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("[worker] iniciado. cap/dia=%d intervalo=%dms", env.WHATSAPP_DAILY_CAP, env.WHATSAPP_MIN_INTERVAL_MS);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = new Date();
    const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);

    if (!isWithinWindow(hour, { startHour: env.WHATSAPP_SEND_START_HOUR, endHour: env.WHATSAPP_SEND_END_HOUR })) {
      await sleep(60_000); // fora do horário comercial
      continue;
    }
    if ((await sentToday(now)) >= env.WHATSAPP_DAILY_CAP) {
      await sleep(60_000); // cap diário atingido
      continue;
    }

    const sent = await processNextJob(now);
    if (sent) {
      await sleep(env.WHATSAPP_MIN_INTERVAL_MS + jitterMs(env.WHATSAPP_JITTER_MS));
    } else {
      await sleep(env.WORKER_POLL_MS); // fila vazia / nada elegível
    }
  }
}

main().catch((e) => {
  console.error("[worker] erro fatal:", e);
  process.exit(1);
});
```

**Step 3: Adicionar o script ao package.json**

Em `scripts`, adicione: `"worker": "tsx src/server/worker/run.ts"`.

**Step 4: Smoke test em mock**

Run (com Postgres de pé, em mock): crie uma campanha com 2-3 leads pela UI, clique iniciar, então:
```bash
npm run worker
```
Expected: logs `[whatsapp:mock] → ...` espaçados pelo intervalo; leads viram `CONTATADO`; jobs viram `SENT`. Encerre com Ctrl+C.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): dispatcher com lock atômico + loop rate-limit/janela/cap"
```

---

## Tarefa 9: Opt-out automático no inbound

**Files:**
- Modify: `src/server/services/conversation.service.ts`

**Step 1: Aplicar o opt-out logo após salvar o inbound**

Em `handleInbound`, **depois** do bloco que salva a `Message(INBOUND)` (Step "1b") e **antes** da transição para `EM_CONVERSA`, insira:

```ts
  // Opt-out: encerra o lead, cancela jobs pendentes, não qualifica nem responde.
  if (isOptOut(input.text)) {
    await prisma.$transaction([
      prisma.lead.update({
        where: { id: lead.id },
        data: { status: "DESCARTADO", optOut: true, optOutAt: new Date() },
      }),
      prisma.outboundJob.updateMany({
        where: { leadId: lead.id, status: { in: ["PENDING", "SENDING"] } },
        data: { status: "CANCELLED", lastError: "opt-out do lead" },
      }),
    ]);
    return { leadId: lead.id };
  }
```

Adicione no topo: `import { isOptOut } from "@/lib/optout";`

**Step 2: Verificar tipos e rodar a suíte**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros; testes passam.

**Step 3: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(deliverability): opt-out automático no inbound (cancela jobs + descarta)"
```

---

## Tarefa 10: Webhook — status de entrega + assinatura + gate de qualidade

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/route.ts`
- Create: `src/server/services/webhook.service.ts` (parse de statuses e quality)

**Step 1: Serviço de status de mensagem e qualidade**

`src/server/services/webhook.service.ts`:

```ts
import { prisma } from "@/server/db/client";

const STATUS_MAP: Record<string, "DELIVERED" | "READ" | "FAILED" | "SENT"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/** Atualiza Message.status a partir dos eventos `statuses` do Graph API. */
export async function applyStatuses(statuses: any[]): Promise<void> {
  for (const s of statuses ?? []) {
    const mapped = STATUS_MAP[s.status];
    if (!mapped || !s.id) continue;
    await prisma.message.updateMany({
      where: { providerMessageId: s.id },
      data: { status: mapped },
    });
  }
}

/**
 * Gate de qualidade: se a Meta sinaliza queda de qualidade do número
 * (event=FLAGGED/quality RED|YELLOW), pausa as campanhas RUNNING.
 */
export async function applyQualityUpdate(value: any): Promise<void> {
  const event = value?.event ?? value?.current_limit ?? value?.quality_rating;
  const degraded =
    value?.quality_rating === "RED" ||
    value?.quality_rating === "YELLOW" ||
    value?.event === "FLAGGED" ||
    value?.event === "DOWNGRADE";
  if (!degraded) return;
  const { count } = await prisma.campaign.updateMany({
    where: { status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  console.warn(`[webhook] qualidade degradada (${JSON.stringify(event)}) → ${count} campanha(s) pausada(s)`);
}
```

**Step 2: Rotear os novos tipos de evento no POST do webhook**

Em `src/app/api/webhooks/whatsapp/route.ts`, dentro do loop `for (const change of entry.changes ?? [])`, antes de processar `messages`, adicione:

```ts
        await applyStatuses(change.value?.statuses ?? []);
        if (change.field === "phone_number_quality_update" || change.value?.quality_rating) {
          await applyQualityUpdate(change.value ?? {});
        }
```

E importe: `import { applyStatuses, applyQualityUpdate } from "@/server/services/webhook.service";`

**Step 3: (Opcional, recomendado) validar a assinatura `X-Hub-Signature-256`**

Se `env.WHATSAPP_APP_SECRET` estiver setado, valide o HMAC SHA-256 do corpo bruto antes de processar (use `crypto` do Node; leia `req.text()` e faça `JSON.parse` manual para ter o raw body). Rejeite com 401 em assinatura inválida. Documente como nota se não implementar agora.

**Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(webhook): status de entrega + gate de qualidade que pausa campanhas"
```

---

## Tarefa 11: UI — refletir fila, opt-out e pausa (mínimo viável)

**Files:**
- Modify: `src/server/services/campaign.service.ts` (`listCampaigns` expõe contagem de jobs)
- Modify: componentes que mostram status de campanha / lead (procure por consumidores de `pendingCount` e do retorno de `/start`)

**Step 1: Expor progresso da fila no `listCampaigns`**

Inclua, por campanha, contagens de `OutboundJob` por status (PENDING/SENT/FAILED) para a UI mostrar progresso real do disparo em vez de "COMPLETED" imediato.

**Step 2: Mostrar badge de opt-out / campanha PAUSED**

No componente de lista de leads e de campanhas, exiba opt-out (lead) e `PAUSED` (campanha) — reuse `LeadStatusBadge`/`Badge` existentes.

**Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): progresso da fila, badges de opt-out e campanha pausada"
```

---

## Tarefa 12: Documentação — hospedagem do worker, warm-up e go-live

**Files:**
- Modify: `README.md` (seção "Decisões de arquitetura para produção")
- Modify: `ANALISE-WHATSAPP.md` (marcar itens implementados)

**Step 1: Documentar a operação**

Adicione ao README:
- Como rodar o worker (`npm run worker`) e por que ele é um **processo separado persistente** (Vercel serverless não segura loop de fila — hospedar o worker em Railway/Render/Fly, ou trocar o loop por cron/QStash chamando uma rota de processamento).
- **Warm-up:** começar com `WHATSAPP_DAILY_CAP` baixo (ex.: 50) e subir gradualmente até 1.000 ao longo de ~2–3 semanas, observando a qualidade.
- **Checklist de go-live Meta:** negócio verificado, número dedicado, display name aprovado, template(s) aprovado(s), token de sistema permanente, forma de pagamento na WABA.
- **Banco gerenciado:** trocar `DATABASE_URL` para Postgres gerenciado e migrar de `db push` para `prisma migrate`.

**Step 2: Atualizar o ANALISE-WHATSAPP.md**

Marque na seção 3 quais componentes de deliverability já foram implementados por este plano.

**Step 3: Commit**

```bash
git add -A
git commit -m "docs: operação do worker, warm-up e checklist de go-live"
```

---

## Verificação final (end-to-end, em mock)

1. `docker compose up -d` → `npm install` → `npm run db:push` → `npm run seed`.
2. `npm run dev` em um terminal; `npm run worker` em outro.
3. Importar leads, criar campanha, "Iniciar" → confirmar que jobs aparecem como PENDING e o worker os processa **espaçados** (não em rajada), respeitando o intervalo.
4. Responder como um lead com "PARAR" → lead vira `DESCARTADO`/optOut, jobs pendentes dele viram CANCELLED, e ele não recebe mais nada.
5. (cloud-api real) simular um webhook de `statuses` → `Message.status` atualiza; simular quality `RED` → campanhas RUNNING viram PAUSED e o worker para de enviar nelas.
6. `npm test` → toda a suíte verde (optout, sendWindow, pipeline, enqueue).

## Fora de escopo deste plano (próximos passos)

- Multi-número com rotação e `WhatsAppNumber` model (só quando passar de ~1 número / volumes maiores).
- BullMQ + Redis no lugar da fila em Postgres (quando o volume justificar concorrência/retry mais sofisticados).
- Migração de `db push` → `prisma migrate` versionado (parte do go-live de banco gerenciado).
- Dashboard de métricas de qualidade/custo por lead qualificado.
