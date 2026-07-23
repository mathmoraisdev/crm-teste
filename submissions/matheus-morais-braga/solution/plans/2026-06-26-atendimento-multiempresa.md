# Atendimento Multi-Empresa (Inbound) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorientar o sistema de "disparador + qualificador de leads" para um **respondedor de atendimento inbound**, onde cada número WhatsApp conectado é uma **empresa** com sua própria persona/base de conhecimento, e qualificação/agendamento viram opcionais por empresa. O disparo em massa fica dormente (escondido da UI, código preservado).

**Architecture:** O motor de inbound já existe ([handleInbound](../../src/server/services/conversation.service.ts)) e o envio de resposta já é direto pelo chip ([sendWhatsAppMessage](../../src/server/services/messaging.ts)), sem passar pela fila de disparo. As mudanças centrais são: (1) `WhatsAppNumber` ganha campos de config por empresa + a identidade do contato passa a ser por número; (2) inbound de número desconhecido **cria** o contato em vez de descartar; (3) um novo agente de **atendimento** responde no contexto da empresa; (4) o roteamento do inbound passa a respeitar os toggles da empresa. Lógica de decisão é extraída em funções **puras testáveis**; caminhos de I/O são verificados por smoke manual via `/api/dev/simulate-reply`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma + PostgreSQL, Baileys (multi-número), OpenAI/Anthropic (BYOK), Vitest.

---

## Convenções deste plano

- **Branch:** todo o trabalho ocorre em `feat/atendimento-multiempresa` (Fase 0).
- **Schema:** o projeto usa `prisma db push` (MVP, sem migrations versionadas). Após editar `schema.prisma`, sempre rode `npm run db:push` e `npm run db:generate`.
- **Testes:** `npm test` roda Vitest. Tests novos ficam ao lado do código (`*.test.ts`), espelhando [pipeline.test.ts](../../src/server/services/pipeline.test.ts). **Só escrevemos testes unitários para funções puras** (sem I/O) — caminhos que tocam Prisma/Baileys são verificados por **smoke manual** descrito em cada fase.
- **Commits:** um commit por tarefa concluída (test+impl juntos quando TDD).
- **Não quebrar o disparo dormente:** o código de campanha continua compilando; só sai da UI.

---

## Visão geral das fases

| Fase | Entrega | Risco |
|------|---------|-------|
| 0 | Branch + baseline verde | — |
| 1 | Schema: config por empresa + identidade do contato por número | **Alto** (unicidade) |
| 2 | Inbound cria contato em vez de descartar | Médio |
| 3 | Agente de atendimento (prompt + builder puro + agent) | Baixo |
| 4 | Roteamento do inbound pelos toggles da empresa | Médio |
| 5 | API + serviço de config da empresa | Baixo |
| 6 | UI: página "Empresas/Atendimentos" + config | Baixo |
| 7 | Esconder disparo (dormente) | Baixo |
| 8 | Verificação E2E + regressão | — |

---

## Fase 0 — Preparação e baseline

### Task 0.1: Branch e baseline verde

**Step 1: Criar branch**

```bash
git checkout -b feat/atendimento-multiempresa
```

**Step 2: Rodar a suíte e confirmar que está verde ANTES de mexer**

Run: `npm test`
Expected: PASS (anote o nº de testes; é a linha de base de regressão).

**Step 3: Confirmar typecheck/lint limpos**

Run: `npm run lint`
Expected: sem erros novos.

**Step 4: Commit (marco vazio opcional — pule se preferir)**

Sem mudanças de código nesta task; só estabelece a base.

---

## Fase 1 — Schema: config por empresa + identidade do contato por número

> **Decisão de modelagem (lida com cuidado):** hoje o contato é único por `@@unique([userId, phone])` ([schema.prisma:123](../../prisma/schema.prisma)). Como **número = empresa**, a mesma pessoa pode falar com duas empresas do mesmo operador e isso deve gerar **duas conversas**. Trocamos a identidade para `@@unique([whatsAppNumberId, phone])`. Isso exige ajustar todo uso do composite Prisma `userId_phone` em `Lead`.

### Task 1.1: Inventariar usos do composite `userId_phone`

> ⚠️ **CRÍTICO:** `userId_phone` é um composite de **DOIS** models. Só o do **Lead** muda nesta fase. O do **WhatsAppNumber** (`@@unique([userId, phone])`, [schema.prisma:241](../../prisma/schema.prisma)) **permanece** — não toque nele.

**Step 1: Localizar todos os usos**

Run: `grep -rn "userId_phone" src/ scripts/`
Expected (inventário já confirmado neste plano — confira que ainda bate):

| Arquivo | Model | Ação |
|---------|-------|------|
| `src/server/services/lead.service.ts:83` | **Lead** (`createLead` upsert) | **CORRIGIR** (Task 1.4) |
| `scripts/seed-test-leads.ts:59` | **Lead** (seed) | **CORRIGIR** (Task 1.4) |
| `src/app/api/numbers/route.ts:60` | WhatsAppNumber (upsert de chip) | **NÃO MEXER** |
| `scripts/wa-link.ts:19` | WhatsAppNumber (pareamento CLI) | **NÃO MEXER** |
| `scripts/migrate-multitenant.ts:69-70` | DDL histórico (string crua) | **NÃO MEXER** (registro da migração antiga) |

**Step 2: Sem código ainda — o inventário acima guia a Task 1.4.**

### Task 1.2: Adicionar campos de config da empresa ao `WhatsAppNumber`

**Files:**
- Modify: `prisma/schema.prisma` (model `WhatsAppNumber`, ~linha 220-244)

**Step 1: Adicionar os campos de config** logo após `dailyCap` no model `WhatsAppNumber`:

```prisma
  dailyCap     Int                  @default(30) // teto/dia deste chip (warm-up / disparo dormente)

  // ── Config de ATENDIMENTO (número = empresa) ───────────────────────────
  displayName       String?  // nome público da empresa (cai p/ `label` se null)
  persona           String?  // tom/estilo do atendente ("formal", "descontraído", instruções)
  knowledgeBase     String?  // FAQ / produtos / serviços (texto livre injetado no prompt)
  businessHours     String?  // horário de atendimento em texto livre ("Seg–Sex 9h–18h")
  customInstructions String? // instruções extras específicas da empresa
  autoReplyEnabled  Boolean  @default(true)  // IA responde automaticamente o inbound
  qualifyEnabled    Boolean  @default(false) // roda qualificação/score (funil de vendas)
  scheduleEnabled   Boolean  @default(false) // permite propor/agendar reunião
```

**Step 2: Aplicar no banco**

Run: `npm run db:push && npm run db:generate`
Expected: `db push` aplica sem perda de dados (campos nulos/com default). `generate` recria o client.

**Step 3: Confirmar que o client compila**

Run: `npx tsc --noEmit`
Expected: sem erros (campos novos disponíveis em `Prisma.WhatsAppNumber*`).

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): config de atendimento por empresa no WhatsAppNumber"
```

### Task 1.3: Trocar a identidade do contato para `(whatsAppNumberId, phone)`

**Files:**
- Modify: `prisma/schema.prisma` (model `Lead`, ~linha 96-126)

**Step 1: Substituir o índice único** no model `Lead`. Trocar:

```prisma
  @@unique([userId, phone])
  @@index([userId])
  @@index([status])
```

por:

```prisma
  // Identidade da conversa é por EMPRESA (número), não por operador:
  // a mesma pessoa pode falar com 2 empresas suas = 2 conversas distintas.
  @@unique([whatsAppNumberId, phone])
  @@index([userId])
  @@index([userId, status])
  @@index([status])
```

> Postgres trata `NULL` como distinto em índices únicos, então leads legados com `whatsAppNumberId = null` não colidem entre si. Contatos novos de inbound sempre terão `whatsAppNumberId` preenchido (o pool Baileys passa o `numberId` — ver [pool.ts:196-201](../../src/server/whatsapp/baileys/pool.ts)).

**Step 2: Aplicar no banco**

Run: `npm run db:push && npm run db:generate`
Expected: aplica. Se `db push` reclamar de dados que violam o novo unique (duplicados `numberId+phone`), resolva manualmente os duplicados antes (em dev provavelmente não há).

**Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): identidade do contato por numero (whatsAppNumberId, phone)"
```

### Task 1.4: Ajustar os usos de `userId_phone` **de Lead**

**Files:**
- Modify: `src/server/services/lead.service.ts` (~linha 82-87, `createLead`)
- Modify: `scripts/seed-test-leads.ts` (~linha 59)

**Step 1: `createLead` — trocar o `upsert` por findFirst + create/update.** Substituir o corpo do `return prisma.lead.upsert({...})`:

```ts
// ANTES (não compila sem o unique userId_phone de Lead):
// return prisma.lead.upsert({
//   where: { userId_phone: { userId, phone } },
//   update: { name, ...(email ? { email } : {}) },
//   create: { userId, name, phone, email, status: "NOVO", consentSource: "manual" },
// });

// DEPOIS — idempotente por (userId, phone) sem depender do unique:
const existing = await prisma.lead.findFirst({ where: { userId, phone }, select: { id: true } });
if (existing) {
  return prisma.lead.update({
    where: { id: existing.id },
    data: { name, ...(email ? { email } : {}) },
  });
}
return prisma.lead.create({
  data: { userId, name, phone, email, status: "NOVO", consentSource: "manual" },
});
```

**Step 2: `scripts/seed-test-leads.ts:59` — mesma troca** (`prisma.lead.upsert({ where: { userId_phone... } })` → `findFirst` + `create`/`update`). Mantenha os dados de seed que já estavam no `create`/`update`.

> Confirme que **NÃO** alterou `src/app/api/numbers/route.ts` nem `scripts/wa-link.ts` (são WhatsAppNumber — corretos).

**Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. Um `grep -rn "userId_phone" src/` agora só deve mostrar `numbers/route.ts` (WhatsAppNumber).

**Step 4: Rodar a suíte (regressão)**

Run: `npm test`
Expected: igual à baseline da Task 0.1 (verde).

**Step 5: Commit**

```bash
git add src/server/services/lead.service.ts scripts/seed-test-leads.ts
git commit -m "refactor: createLead/seed sem composite userId_phone (Lead por numero)"
```

---

## Fase 2 — Inbound cria contato em vez de descartar

> Hoje [handleInbound](../../src/server/services/conversation.service.ts) loga e **descarta** quando nenhum lead casa ("Não cria lead solto"). Em atendimento, inbound de número desconhecido **cria** o contato atrelado à empresa (número) que recebeu.

### Task 2.1: Função pura — decidir se cria contato

**Files:**
- Create: `src/server/services/inbound-resolve.ts`
- Test: `src/server/services/inbound-resolve.test.ts`

**Step 1: Escrever o teste falho**

```ts
import { describe, it, expect } from "vitest";
import { shouldCreateContact } from "./inbound-resolve";

describe("shouldCreateContact", () => {
  it("cria quando há número da empresa + telefone e nenhum lead casou", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: "n1", phone: "+5511999" }))
      .toBe(true);
  });
  it("não cria se já casou um lead", () => {
    expect(shouldCreateContact({ matched: true, whatsAppNumberId: "n1", phone: "+5511999" }))
      .toBe(false);
  });
  it("não cria sem número da empresa (ex.: cloud-api sem mapa)", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: undefined, phone: "+5511999" }))
      .toBe(false);
  });
  it("não cria sem telefone", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: "n1", phone: undefined }))
      .toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- inbound-resolve`
Expected: FAIL ("shouldCreateContact is not a function" / módulo não encontrado).

**Step 3: Implementar mínimo**

```ts
/**
 * Decisão PURA: criar um contato novo a partir de um inbound?
 * Sim quando nenhum lead casou E temos a empresa (whatsAppNumberId) + telefone.
 * Sem o número da empresa (cloud-api sem mapa) não criamos contato solto.
 */
export function shouldCreateContact(input: {
  matched: boolean;
  whatsAppNumberId?: string;
  phone?: string;
}): boolean {
  return !input.matched && !!input.whatsAppNumberId && !!input.phone;
}
```

**Step 4: Rodar e ver passar**

Run: `npm test -- inbound-resolve`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/inbound-resolve.ts src/server/services/inbound-resolve.test.ts
git commit -m "feat: shouldCreateContact (decisao pura de criar contato no inbound)"
```

### Task 2.2: Habilitar `simulate-reply` a aceitar inbound por número+telefone

> Hoje o route ([simulate-reply/route.ts](../../src/app/api/dev/simulate-reply/route.ts)) **exige `leadId`** (schema `z.object({ leadId, text })`) e usa a sessão (`getCurrentUserId`). Para testar a criação de contato precisamos aceitar `{ whatsAppNumberId, phone }`. Esta task vem **antes** do smoke da Task 2.3.

**Files:**
- Modify: `src/app/api/dev/simulate-reply/route.ts`

**Step 1: Trocar o schema** para aceitar `leadId` OU (`whatsAppNumberId` + `phone`), mantendo retrocompat:

```ts
const schema = z
  .object({
    leadId: z.string().min(1).optional(),
    whatsAppNumberId: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    text: z.string().min(1, "Mensagem vazia"),
  })
  .refine((d) => !!d.leadId || (!!d.whatsAppNumberId && !!d.phone), {
    message: "Informe leadId, ou whatsAppNumberId + phone.",
  });
```

**Step 2: Repassar os campos a `handleInbound`** (mantendo `userId` da sessão e o providerMessageId sintético):

```ts
const { leadId, whatsAppNumberId, phone, text } = parsed.data;
const providerMessageId = `sim-${leadId ?? phone}-${Date.now()}`;
const result = await handleInbound({ leadId, whatsAppNumberId, phone, userId, text, providerMessageId });
return NextResponse.json({ ok: true, ...result });
```

> `userId` continua vindo da sessão. Quando há `whatsAppNumberId+phone`, o `handleInbound` resolve o dono pelo número (a sessão e o dono do número são o mesmo operador em dev).

**Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (todos os campos passados já existem em `InboundInput`).

**Step 4: Commit**

```bash
git add src/app/api/dev/simulate-reply/route.ts
git commit -m "chore(dev): simulate-reply aceita inbound por numero+telefone"
```

### Task 2.3: Criar contato no `handleInbound` + smoke

**Files:**
- Modify: `src/server/services/conversation.service.ts` (bloco `if (!lead)`, ~linha 92-102)

**Step 1: Trocar `const lead` por `let lead`** na linha `const lead = await resolveLead(input);` (~linha 90), e **substituir o bloco `if (!lead) { ... return { leadId: null } }`** por:

```ts
import { shouldCreateContact } from "./inbound-resolve";
// ...

let lead = await resolveLead(input);

if (!lead) {
  if (shouldCreateContact({ matched: false, whatsAppNumberId: input.whatsAppNumberId, phone: input.phone })) {
    // Descobre o dono (operador) a partir da empresa (número) que recebeu.
    const num = await prisma.whatsAppNumber.findUnique({
      where: { id: input.whatsAppNumberId! },
      select: { userId: true },
    });
    if (num) {
      lead = await prisma.lead.create({
        data: {
          userId: num.userId,
          whatsAppNumberId: input.whatsAppNumberId!,
          phone: input.phone!,
          name: input.phone!, // sem nome ainda; o telefone é o rótulo inicial
          status: "EM_CONVERSA",
          consentSource: "inbound", // o cliente iniciou o contato (base legal p/ responder)
        },
      });
    }
  }
  if (!lead) {
    if (input.phone) {
      console.warn(
        `[inbound] descartado: sem empresa p/ criar contato telefone=${input.phone} chip=${input.whatsAppNumberId ?? "—"}`,
      );
    }
    return { leadId: null };
  }
}
```

> O restante de `handleInbound` (dedupe, opt-out, qualifica/responde) segue inalterado e agora opera sobre o contato recém-criado.

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Smoke manual (I/O — sem teste unitário)**

Preparação:
1. `WHATSAPP_MODE=mock` basta para este teste (não envia de verdade).
2. Suba o dev server (`npm run dev`) e **faça login** no navegador (a rota exige sessão).
3. Crie um `WhatsAppNumber` de teste no Prisma Studio (`npx prisma studio`) com o `userId` da sua conta logada. Anote o `id` (`numId`).

Execute o smoke **no console do navegador** (assim o cookie de sessão vai junto — `curl` daria 401):

```js
await fetch("/api/dev/simulate-reply", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ whatsAppNumberId: "<numId>", phone: "+5511970000001", text: "oi, vocês atendem o quê?" }),
}).then(r => r.json())
```

Expected: novo `Lead` (status `EM_CONVERSA`, `whatsAppNumberId=<numId>`, `consentSource=inbound`) + uma `Message(INBOUND)`. Verifique no Prisma Studio. (A resposta automática só aparece após a Fase 4; aqui validamos só a criação do contato.)

**Step 4: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(inbound): cria contato da empresa quando telefone novo chega"
```

---

## Fase 3 — Agente de atendimento

> Novo agente que **responde dúvidas** no contexto da empresa (persona + base de conhecimento + horário). Vira o respondedor padrão; `generateNextQuestion` (qualificação) só roda quando `qualifyEnabled`.

### Task 3.1: Prompt de atendimento

**Files:**
- Modify: `src/server/ai/prompts.ts`

**Step 1: Adicionar `ATTENDANCE_SYSTEM`** ao final do arquivo:

```ts
export const ATTENDANCE_SYSTEM = `Você é um atendente virtual de uma empresa, respondendo clientes pelo WhatsApp.

Você recebe o CONTEXTO da empresa (persona, base de conhecimento, horário de atendimento) e a conversa até agora. Escreva a PRÓXIMA mensagem a enviar ao cliente.

Regras:
- Responda SEMPRE no idioma do cliente (padrão: português brasileiro), tom de WhatsApp: cordial, direto, no máximo 1 emoji.
- Use APENAS as informações da base de conhecimento fornecida. Se a resposta não estiver lá, seja honesto ("vou verificar isso e te retorno") em vez de inventar. Nunca invente preços, prazos ou políticas.
- Respeite a persona/estilo informado pela empresa.
- Se perguntarem por horário de atendimento e ele foi informado, use-o.
- Mensagens curtas e objetivas. Sem preâmbulos longos ("Claro!", "Com certeza!"). Vá direto, de forma simpática.
- Responda APENAS com o texto da mensagem, nada mais.`;
```

**Step 2: Commit**

```bash
git add src/server/ai/prompts.ts
git commit -m "feat(ai): prompt de atendimento (ATTENDANCE_SYSTEM)"
```

### Task 3.2: Builder puro do contexto da empresa

**Files:**
- Create: `src/server/ai/attendance-context.ts`
- Test: `src/server/ai/attendance-context.test.ts`

**Step 1: Teste falho**

```ts
import { describe, it, expect } from "vitest";
import { buildAttendanceContext } from "./attendance-context";

describe("buildAttendanceContext", () => {
  it("inclui persona, base e horário quando presentes", () => {
    const out = buildAttendanceContext({
      displayName: "Acme",
      persona: "descontraído",
      knowledgeBase: "Vendemos guarda-chuvas. Frete grátis acima de R$100.",
      businessHours: "Seg–Sex 9h–18h",
    });
    expect(out).toContain("Acme");
    expect(out).toContain("descontraído");
    expect(out).toContain("guarda-chuvas");
    expect(out).toContain("Seg–Sex 9h–18h");
  });

  it("omite seções ausentes sem quebrar", () => {
    const out = buildAttendanceContext({ displayName: null, persona: null, knowledgeBase: null, businessHours: null });
    expect(out).not.toContain("Persona:");
    expect(out).not.toContain("Horário");
    expect(typeof out).toBe("string");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- attendance-context`
Expected: FAIL (módulo inexistente).

**Step 3: Implementar**

```ts
/**
 * Monta (PURA) o bloco de contexto da empresa para o prompt de atendimento.
 * Omite seções ausentes para não poluir o prompt com "null".
 */
export function buildAttendanceContext(c: {
  displayName?: string | null;
  persona?: string | null;
  knowledgeBase?: string | null;
  businessHours?: string | null;
}): string {
  const parts: string[] = [];
  if (c.displayName) parts.push(`Empresa: ${c.displayName}`);
  if (c.persona) parts.push(`Persona/estilo: ${c.persona}`);
  if (c.businessHours) parts.push(`Horário de atendimento: ${c.businessHours}`);
  if (c.knowledgeBase) parts.push(`Base de conhecimento:\n${c.knowledgeBase}`);
  return parts.join("\n\n");
}
```

**Step 4: Rodar e ver passar**

Run: `npm test -- attendance-context`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/ai/attendance-context.ts src/server/ai/attendance-context.test.ts
git commit -m "feat(ai): builder puro do contexto da empresa p/ atendimento"
```

### Task 3.3: Agente `generateAttendanceReply`

**Files:**
- Modify: `src/server/ai/conversation.agent.ts`

**Step 1: Adicionar a função** (espelha `generateNextQuestion`, tier "cheap"):

```ts
import { ATTENDANCE_SYSTEM, CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import { buildAttendanceContext } from "./attendance-context";
// ...

/**
 * Agente de ATENDIMENTO — gera a próxima mensagem respondendo o cliente no
 * contexto da empresa (persona + base de conhecimento + horário).
 */
export async function generateAttendanceReply(opts: {
  ai: AiClient;
  company: {
    displayName?: string | null;
    persona?: string | null;
    knowledgeBase?: string | null;
    businessHours?: string | null;
    customInstructions?: string | null;
  };
  conversation: ConversationTurn[];
}): Promise<string> {
  const context = buildAttendanceContext(opts.company);
  const extra = opts.company.customInstructions
    ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
    : "";
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 400,
    system: ATTENDANCE_SYSTEM,
    user:
      `${context}${extra}\n\n` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem ao cliente.`,
  });
  return text || "Oi! Como posso te ajudar?";
}
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/server/ai/conversation.agent.ts
git commit -m "feat(ai): generateAttendanceReply (responde no contexto da empresa)"
```

---

## Fase 4 — Roteamento do inbound pelos toggles da empresa

> O inbound deixa de sempre qualificar. Passa a: **sempre atender** (se `autoReplyEnabled`); qualificar/pontuar só se `qualifyEnabled`; agendar só se `scheduleEnabled`.

### Task 4.1: Função pura — modo de atendimento

**Files:**
- Create: `src/server/services/inbound-mode.ts`
- Test: `src/server/services/inbound-mode.test.ts`

**Step 1: Teste falho**

```ts
import { describe, it, expect } from "vitest";
import { decideInboundMode } from "./inbound-mode";

const base = { autoReplyEnabled: true, qualifyEnabled: false, scheduleEnabled: false };

describe("decideInboundMode", () => {
  it("atendimento puro: responde, não qualifica, não agenda", () => {
    expect(decideInboundMode(base)).toEqual({ reply: true, qualify: false, allowSchedule: false });
  });
  it("com qualificação ligada", () => {
    expect(decideInboundMode({ ...base, qualifyEnabled: true }).qualify).toBe(true);
  });
  it("com agendamento ligado", () => {
    expect(decideInboundMode({ ...base, scheduleEnabled: true }).allowSchedule).toBe(true);
  });
  it("autoReply desligado: não responde (handoff total p/ humano)", () => {
    expect(decideInboundMode({ ...base, autoReplyEnabled: false }).reply).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- inbound-mode`
Expected: FAIL.

**Step 3: Implementar**

```ts
export interface InboundMode {
  reply: boolean;         // IA responde automaticamente
  qualify: boolean;       // roda qualificação/score
  allowSchedule: boolean; // pode propor/agendar reunião
}

/** PURA: traduz os toggles da empresa no comportamento do inbound. */
export function decideInboundMode(cfg: {
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
}): InboundMode {
  return {
    reply: cfg.autoReplyEnabled,
    qualify: cfg.qualifyEnabled,
    allowSchedule: cfg.scheduleEnabled,
  };
}
```

**Step 4: Rodar e ver passar**

Run: `npm test -- inbound-mode`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/inbound-mode.ts src/server/services/inbound-mode.test.ts
git commit -m "feat: decideInboundMode (toggles da empresa -> comportamento)"
```

### Task 4.2: Aplicar o modo no `handleInbound`

**Files:**
- Modify: `src/server/services/conversation.service.ts` (bloco "4. Qualifica → decide → age", ~linha 164-207)

**Step 1: Carregar a config da empresa** logo após resolver/criar o lead e antes do passo 4. O lead tem `whatsAppNumberId`; busque a config:

```ts
import { decideInboundMode } from "./inbound-mode";
import { generateAttendanceReply } from "@/server/ai/conversation.agent";
// ...

// Config da empresa (número) dona da conversa. Default seguro se faltar número.
const company = lead.whatsAppNumberId
  ? await prisma.whatsAppNumber.findUnique({
      where: { id: lead.whatsAppNumberId },
      select: {
        displayName: true, label: true, persona: true, knowledgeBase: true,
        businessHours: true, customInstructions: true,
        autoReplyEnabled: true, qualifyEnabled: true, scheduleEnabled: true,
      },
    })
  : null;

const mode = decideInboundMode({
  autoReplyEnabled: company?.autoReplyEnabled ?? true,
  qualifyEnabled: company?.qualifyEnabled ?? false,
  scheduleEnabled: company?.scheduleEnabled ?? false,
});
```

**Step 2: Reescrever o passo 4** para ramificar pelo `mode`. A lógica de agendamento (meeting PROPOSED / REUNIAO_AGENDADA, ~linha 150-162) **permanece acima**. Substituir o bloco a partir de "4. Qualifica → decide → age" (linha 164) até o fim da função por:

```ts
// 4. Atendimento é o respondedor padrão. Qualificação/agendamento são opcionais
//    (toggles da empresa) e apenas pontuam/desviam o fluxo.
const ai = await getAiClient(lead.userId);
const conversation = await loadConversation(lead.id);

let shouldSchedule = false;
let shouldDiscard = false;

// 4a. Qualificação opcional — atualiza score/funil e pode pedir descarte/agenda.
if (mode.qualify) {
  const qual = await qualifyLead({ ai, leadId: lead.id, leadName: lead.name, conversation });
  const d = decidePipeline({ current: status, score: qual.score, nextAction: qual.nextAction });
  shouldSchedule = d.shouldSchedule && mode.allowSchedule;
  shouldDiscard = d.shouldDiscard;
  if (d.status !== status) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: d.status } });
  }
}

// 4b. Descartado pela qualificação → silêncio.
if (shouldDiscard) return { leadId: lead.id };

// 4c. Agendamento opcional tem precedência sobre a resposta livre.
if (shouldSchedule) {
  await proposeSlots(lead.id);
  return { leadId: lead.id };
}

// 4d. Atendimento: responde a dúvida no contexto da empresa (sempre que autoReply).
if (mode.reply) {
  const reply = await generateAttendanceReply({
    ai,
    company: {
      displayName: company?.displayName ?? company?.label ?? null,
      persona: company?.persona ?? null,
      knowledgeBase: company?.knowledgeBase ?? null,
      businessHours: company?.businessHours ?? null,
      customInstructions: company?.customInstructions ?? null,
    },
    conversation,
  });
  await sendWhatsAppMessage(lead, reply);
}
// !mode.reply → handoff total: só persiste o inbound (humano responde via /reply).

return { leadId: lead.id };
```

> **Decisão congelada:** o agente de **atendimento** é sempre o respondedor (mesmo com `qualify` ligado). `generateNextQuestion` (SDR) deixa de ser chamado no inbound.

**Step 2b: Remover o import morto.** Como `generateNextQuestion` não é mais usado, ajustar a linha 3 de `conversation.service.ts`:

```ts
// ANTES:
// import { generateNextQuestion } from "@/server/ai/conversation.agent";
// DEPOIS:
import { generateAttendanceReply } from "@/server/ai/conversation.agent";
```

(Confirme com `grep -n "generateNextQuestion" src/server/services/conversation.service.ts` → zero ocorrências.)

**Step 3: Typecheck + regressão**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros; suíte verde.

**Step 4: Smoke manual — 3 combinações de toggle**

Com um `WhatsAppNumber` de teste (ajuste os toggles via Prisma Studio):

1. **Atendimento puro** (`autoReply=true, qualify=false, schedule=false`, `knowledgeBase` preenchida): `curl` simulate-reply com "vocês fazem entrega?" → resposta deve usar a base de conhecimento, sem score.
2. **Com qualificação** (`qualify=true`): mesmo inbound → além de responder/escalar, cria `Qualification` com score.
3. **autoReply=false**: inbound → só persiste `Message(INBOUND)`, nenhuma resposta enviada.

Expected: comportamento conforme cada toggle. Verifique `Message`/`Qualification` no Prisma Studio e os logs `[inbound]`.

**Step 5: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(inbound): roteia por toggles da empresa (atende/qualifica/agenda)"
```

---

## Fase 5 — API + serviço de config da empresa

### Task 5.1: Estender `updateWhatsAppNumber` com os campos de config

**Files:**
- Modify: `src/server/services/numbers.service.ts`

**Step 1: Ampliar a assinatura e o `data`** de `updateWhatsAppNumber` para aceitar os campos novos (mantendo a validação de `status`):

```ts
export async function updateWhatsAppNumber(
  id: string,
  userId: string,
  data: {
    label?: string;
    dailyCap?: number;
    status?: WhatsAppNumberStatus;
    displayName?: string | null;
    persona?: string | null;
    knowledgeBase?: string | null;
    businessHours?: string | null;
    customInstructions?: string | null;
    autoReplyEnabled?: boolean;
    qualifyEnabled?: boolean;
    scheduleEnabled?: boolean;
  },
): Promise<void> {
  const exists = await prisma.whatsAppNumber.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Número não encontrado");
  if (data.status !== undefined && !MANUAL_STATUSES.has(data.status)) {
    throw new Error("Status não permitido por aqui (use pausar/reativar/desativar).");
  }
  // Monta o patch só com o que veio (undefined = não mexe; null limpa o campo).
  // Build explícito p/ satisfazer Prisma.WhatsAppNumberUpdateInput (Object.fromEntries
  // perde a tipagem e quebra o tsc).
  const patch: Prisma.WhatsAppNumberUpdateInput = {};
  if (data.label !== undefined) patch.label = data.label;
  if (data.dailyCap !== undefined) patch.dailyCap = data.dailyCap;
  if (data.status !== undefined) patch.status = data.status;
  if (data.displayName !== undefined) patch.displayName = data.displayName;
  if (data.persona !== undefined) patch.persona = data.persona;
  if (data.knowledgeBase !== undefined) patch.knowledgeBase = data.knowledgeBase;
  if (data.businessHours !== undefined) patch.businessHours = data.businessHours;
  if (data.customInstructions !== undefined) patch.customInstructions = data.customInstructions;
  if (data.autoReplyEnabled !== undefined) patch.autoReplyEnabled = data.autoReplyEnabled;
  if (data.qualifyEnabled !== undefined) patch.qualifyEnabled = data.qualifyEnabled;
  if (data.scheduleEnabled !== undefined) patch.scheduleEnabled = data.scheduleEnabled;
  await prisma.whatsAppNumber.update({ where: { id }, data: patch });
}
```

> Adicione `Prisma` ao import de tipos no topo do arquivo: `import type { WhatsAppNumberStatus, Prisma } from "@prisma/client";`.

**Step 2: Incluir a config no `listWhatsAppNumbers`** (para a UI editar). Adicionar os campos ao `select` e ao `WhatsAppNumberListItem`:

```ts
export interface WhatsAppNumberListItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
  pairingQr: string | null;
  // config de atendimento
  displayName: string | null;
  persona: string | null;
  knowledgeBase: string | null;
  businessHours: string | null;
  customInstructions: string | null;
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
}
```

E no `select` do `findMany`, adicionar: `displayName, persona, knowledgeBase, businessHours, customInstructions, autoReplyEnabled, qualifyEnabled, scheduleEnabled`.

**Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/server/services/numbers.service.ts
git commit -m "feat(numbers): config de atendimento no service (update + list)"
```

### Task 5.2: Aceitar os campos no PATCH `/api/numbers/[id]`

**Files:**
- Modify: `src/app/api/numbers/[id]/route.ts`

**Step 1: Ampliar o `updateSchema` EXISTENTE** (linhas 13-26) adicionando os campos de config **antes** do `.refine(...)` final — preserve o `.refine((d) => Object.keys(d).length > 0)` e o `.enum` de status já existentes:

```ts
const updateSchema = z
  .object({
    label: z.string().min(1, "Informe um apelido").optional(),
    dailyCap: z.number().int().positive("Cap deve ser positivo").optional(),
    status: z
      .enum([
        WhatsAppNumberStatus.CONNECTED,
        WhatsAppNumberStatus.PAUSED,
        WhatsAppNumberStatus.DISABLED,
      ])
      .optional(),
    // ── config de atendimento (número = empresa) ──
    displayName: z.string().max(120).nullable().optional(),
    persona: z.string().max(2000).nullable().optional(),
    knowledgeBase: z.string().max(8000).nullable().optional(), // teto p/ caber no prompt
    businessHours: z.string().max(500).nullable().optional(),
    customInstructions: z.string().max(2000).nullable().optional(),
    autoReplyEnabled: z.boolean().optional(),
    qualifyEnabled: z.boolean().optional(),
    scheduleEnabled: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
```

> A chamada `updateWhatsAppNumber(id, userId, parsed.data)` (linha 44) **já repassa tudo** — não precisa mudar. Os tipos casam com a assinatura ampliada na Task 5.1.

**Step 2: Smoke**

```bash
curl -X PATCH http://localhost:3000/api/numbers/<numId> \
  -H "content-type: application/json" -H "cookie: <sessão válida>" \
  -d '{"displayName":"Acme","knowledgeBase":"Vendemos X. Frete grátis acima de R$100.","autoReplyEnabled":true}'
```

Expected: 200; campos gravados (confira no Studio).

**Step 3: Commit**

```bash
git add src/app/api/numbers/[id]/route.ts
git commit -m "feat(api): PATCH /numbers aceita config de atendimento"
```

---

## Fase 6 — UI: página "Empresas/Atendimentos"

> Extrair a gestão de números de dentro de [CampaignsView.tsx](../../src/components/CampaignsView.tsx) para uma página própria e adicionar a edição de persona/base/toggles.

### Task 6.1: Página dedicada `/empresas`

**Files:**
- Create: `src/app/(app)/empresas/page.tsx`
- Modify: `src/components/WhatsAppNumbersPanel.tsx` (acrescentar config; é o componente reaproveitado)

**Step 1: Criar a página** que monta o painel:

```tsx
import { WhatsAppNumbersPanel } from "@/components/WhatsAppNumbersPanel";

export const dynamic = "force-dynamic";

export default function EmpresasPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Empresas &amp; Atendimentos</h1>
        <p className="text-sm text-slate-500">
          Cada número conectado é uma empresa. Configure a persona, a base de conhecimento e o que a IA pode fazer.
        </p>
      </header>
      <WhatsAppNumbersPanel />
    </div>
  );
}
```

**Step 2: No `WhatsAppNumbersPanel`**, estender `NumberItem` com os campos de config e adicionar um **modal "Atendimento"** por número (botão de engrenagem na linha) com: `displayName`, `persona`, `businessHours`, `knowledgeBase` (textarea), `customInstructions` (textarea) e 3 checkboxes (`autoReplyEnabled`, `qualifyEnabled`, `scheduleEnabled`). Salva via o `patchNumber` já existente. Reuse os componentes `Modal`/`Button` já importados. (Siga o padrão do modal de edição existente, linhas 398-435.)

**Step 3: Smoke (UI)**

Run: `npm run dev` → abrir `/empresas` → editar a config de um número → salvar → recarregar e confirmar persistência.

**Step 4: Commit**

```bash
git add src/app/(app)/empresas/page.tsx src/components/WhatsAppNumbersPanel.tsx
git commit -m "feat(ui): pagina Empresas com config de atendimento por numero"
```

### Task 6.2: Atualizar a navegação

**Files:**
- Modify: `src/components/app/Sidebar.tsx`

**Step 1: Trocar o nav**: remover "Campanhas", adicionar "Empresas", renomear "Leads" → "Conversas". Atualizar `NAV` (linhas 10-14):

```ts
import { Users, Building2, Settings, LogOut } from "lucide-react";
// ...
const NAV = [
  { href: "/leads", label: "Conversas", icon: Users },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];
```

**Step 2: Apontar o card inferior** "Números WhatsApp" (linhas 60-70) para `/empresas` em vez de `/campaigns`. Atualizar o texto do card para "Empresas & atendimentos".

**Step 3: Smoke** — navegação mostra Conversas/Empresas/Configurações; links funcionam.

**Step 4: Commit**

```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat(ui): nav -> Conversas + Empresas (remove Campanhas)"
```

---

## Fase 7 — Esconder o disparo (dormente, sem apagar)

### Task 7.1: Tornar a rota de campanhas inacessível pela navegação

**Files:**
- Modify: `src/app/(app)/campaigns/page.tsx`

**Step 1: Remover `<WhatsAppNumbersPanel />` do `CampaignsView`** ([CampaignsView.tsx:276](../../src/components/CampaignsView.tsx) — a linha `<WhatsAppNumbersPanel />` e seu import na linha 13), já que ele foi migrado para `/empresas` na Fase 6 (evita render duplicado). O resto da página de campanhas permanece no código, mas sem link no nav (Fase 6) já fica fora do fluxo.

**Step 2 (opcional, recomendado): Guardar o início de campanha** atrás de flag de ambiente, para impedir disparo acidental enquanto dormente.

**Files:**
- Modify: `src/app/api/campaigns/[id]/start/route.ts`

Adicionar como **primeira linha** do handler `POST` (leitura crua de `process.env`, sem mexer no schema de `@/lib/env` nem adicionar imports):

```ts
if (process.env.ENABLE_DISPATCH !== "1") {
  return NextResponse.json({ error: "Disparo desativado nesta instalação." }, { status: 403 });
}
```

> Mantém o motor de disparo intacto; reativável com `ENABLE_DISPATCH=1`. (`NextResponse` já está importado no route — confirme; se não, importe de `next/server`.)

**Step 3: Typecheck + regressão**

Run: `npx tsc --noEmit && npm test`
Expected: verde.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(disparo): dormente — fora da UI e start atras de flag"
```

### Task 7.2: Esconder import de CSV / criação de campanha da UI

**Files:**
- Modify: `src/components/LeadsDashboard.tsx` (botão "Importar CSV", linha ~165 + modal `CsvUpload` linha ~240)
- Modify: `src/components/CampaignsView.tsx` (botão "Nova campanha", linha ~114)

**Step 1: Ocultar o CTA "Importar CSV"** em `LeadsDashboard.tsx` — remova/comente o `<Button ...>Importar CSV</Button>` e o `<Modal>...<CsvUpload/></Modal>` associado (e o estado `importOpen` se ficar sem uso, para não gerar lint de variável não usada). O endpoint `/api/leads/import` e `CsvUpload.tsx` permanecem (dormentes).

**Step 2: Ocultar "Nova campanha"** em `CampaignsView.tsx:114` (a página já está fora do nav; remover o CTA evita criar campanha por URL direta).

**Step 3: Smoke** — `/leads` e `/empresas` não exibem mais ações de disparo/import.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): oculta import CSV e criacao de campanha"
```

---

## Fase 8 — Verificação E2E e regressão

### Task 8.1: Suíte completa + typecheck + lint

**Step 1:** Run: `npm test`
Expected: verde, com os testes novos (`inbound-resolve`, `attendance-context`, `inbound-mode`) somados à baseline.

**Step 2:** Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3:** Run: `npm run lint`
Expected: sem erros novos.

### Task 8.2: Smoke E2E do fluxo de atendimento (modo baileys ou mock)

> **Como "simular inbound":** logado no navegador, rode no console o `fetch("/api/dev/simulate-reply", ...)` da Task 2.3 (o cookie de sessão vai junto). No modo `mock`, a resposta da IA é persistida como `Message(OUTBOUND)` mas não sai num WhatsApp real — confira em `/leads` ou no Prisma Studio. No modo `baileys` com chip conectado, a resposta sai de verdade.

**Step 1: Cenário "empresa A — atendimento puro com base de conhecimento":**
- Em `/empresas`, conecte (ou crie via Studio) um número, defina `displayName`, `knowledgeBase`, `autoReplyEnabled=on`, `qualify/schedule=off`.
- Simule inbound: "qual o horário de vocês?" e "vocês entregam em SP?".
- Expected: respostas coerentes com a base; nenhuma `Qualification`; conversa visível em `/leads`.

**Step 2: Cenário "empresa B — atendimento + qualificação":**
- Outro número com `qualifyEnabled=on`.
- Inbound demonstrando interesse.
- Expected: responde E cria `Qualification` com score; status do contato evolui.

**Step 3: Cenário "isolamento entre empresas":**
- Mesmo telefone (+55...0001) conversa com empresa A e empresa B.
- Expected: **dois** contatos distintos (um por `whatsAppNumberId`), históricos separados. (Valida a Task 1.3.)

**Step 4: Cenário "handoff/opt-out preservados":**
- Com `aiPaused=true` num contato: inbound só persiste, sem resposta.
- Inbound "PARAR": contato vai a `DESCARTADO`/optOut. (Regressão do comportamento legado.)

**Step 5: Commit final + abrir PR (somente se o usuário pedir)**

```bash
git push -u origin feat/atendimento-multiempresa
```

---

## Apêndice — Checklist de "sem lacunas"

- [ ] `grep -rn "userId_phone" src/ scripts/ prisma/` não retorna usos de **Lead** (Task 1.4).
- [ ] Todo inbound com `whatsAppNumberId` cria contato quando o telefone é novo (Task 2.2).
- [ ] `autoReplyEnabled=false` ⇒ IA não responde; opt-out e handoff continuam funcionando (Task 4.2 / 8.2).
- [ ] Qualificação/agendamento só rodam com os toggles ligados (Task 4.2).
- [ ] Resposta da IA usa apenas a base de conhecimento da empresa correta (Task 3.x / 8.2).
- [ ] Dois contatos para o mesmo telefone em empresas diferentes (Task 1.3 / 8.2).
- [ ] Disparo inacessível pela UI e protegido por flag (Fase 7).
- [ ] `npm test`, `tsc --noEmit`, `npm run lint` verdes (Fase 8).
