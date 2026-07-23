# Automação de ciclo de vida — o funil não esfria sozinho

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 10, Onda E, Release 3).

**Goal:** transformar em automático o que hoje depende de o operador lembrar de fazer na mão: (1)
**pós-venda** — um "obrigado pela preferência" algumas horas depois de a comanda ser paga; (2)
**pedido de avaliação/NPS** — um dia depois do atendimento; (3) **reengajamento de lead frio** — uma
mensagem de win-back para quem conversou e sumiu há N dias. Tudo roda no **worker** (mesmo tick dos
lembretes), respeita **opt-out/LGPD**, é **idempotente** (nunca manda o mesmo toque duas vezes) e
**opt-in por conta** (nada dispara para quem não ligou). Nenhuma conta recebe mensagem nova até o dono
ligar a automação **e** o operador da plataforma habilitar o kill-switch global.

**Architecture:** o coração de decisão é **puro** em `src/lib/lifecycle.ts` (sem DB): `isDueAfter`
(um evento com marcador nulo passou do atraso configurado?) e os **templates**/render de mensagem —
100% testável, mesmo padrão de `dueReminder`/`renderReminderTemplate` de
[meeting-reminders.ts](../../src/server/services/meeting-reminders.ts). Um serviço
`lifecycle-automation.ts` faz o **efeito** (varre → envia → marca), copiando fielmente o padrão
idempotente de `dispatchDueReminders`: **só grava o marcador APÓS enviar** (retry no próximo tick em
caso de falha). O worker chama `dispatchLifecycleAutomations(now)` num **tick próprio throttled**
(default 15 min — granularidade é hora/dia), do mesmo jeito que já chama `dispatchDueReminders` e
`purgeExpiredMedia`. O envio reusa `sendWhatsAppMessage(lead, texto, { source: "SYSTEM" })` — a mesma
fonte única de verdade dos lembretes.

**Tech Stack:** Prisma · Postgres (Supabase) · Zod · Vitest · Next.js (App Router) · TailwindCSS
(tokens/CSS vars — nunca hex [[design-tokens-dark-theme]]).

**Decisões travadas (produto):**
- **Off por padrão, em duas chaves.** Nada dispara sem (a) o **kill-switch global** de ambiente
  `LIFECYCLE_AUTOMATION=true` (o operador da PLATAFORMA liga — igual `MEDIA_RETENTION_DAYS` sobe
  inerte [[media-retention-design]]) **e** (b) o **opt-in por conta** `User.lifecycleAutomationEnabled`
  (o DONO do salão/loja consente automatizar mensagem ao SEU cliente). As duas precisam ser `true`.
  Multi-tenant: um flag global sozinho mandaria mensagem para o cliente de TODA conta — inaceitável.
  Por isso o toque só sai por conta que ligou ([[product-readiness-baseline]] — furo de cold-outbound).
- **Cada toque é opt-in independente por atraso.** `LIFECYCLE_POSTSALE_HOURS` / `LIFECYCLE_REVIEW_HOURS`
  / `LIFECYCLE_REENGAGE_DAYS`: **0 = desligado**. Uma barbearia pode querer só o NPS; um delivery só o
  reengajamento. Cada um liga sozinho.
- **Idempotência por marcador de janela** (o padrão do codebase). Pós-venda e NPS ancoram na **comanda
  FECHADA** (`Order.postSaleThankedAt` / `Order.reviewRequestedAt`); reengajamento ancora no **lead**
  (`Lead.lastEngagedAt`). O marcador é gravado **só após o envio** — falha não marca, retenta. Mesmo
  espírito de `remindedDayBeforeAt`/`remindedHourBeforeAt`.
- **Âncora do pós-venda/NPS = `Order` FECHADA com lead.** Comanda de balcão E agendamento REALIZADO
  **convergem** numa comanda FECHADA (`Appointment.orderId`, "comanda gerada quando REALIZADO"
  [schema.prisma:869](../../prisma/schema.prisma#L869)). Anco­rar num único lugar evita mensagem dupla.
  `closedAt` é a base da janela. Comanda **avulsa** (sem `leadId`) não tem para onde enviar → ignorada.
- **Piso anti-backlog.** Ao LIGAR a automação pela primeira vez, não sair disparando o histórico
  inteiro: `LIFECYCLE_BACKLOG_FLOOR_DAYS` (default 7) — eventos mais antigos que isso não recebem toque
  retroativo. Mesma preocupação de "não blastar o passado" que o cutover de reminders teve.
- **Janela comercial respeitada.** O tick só envia dentro de `WHATSAPP_SEND_START_HOUR..END_HOUR`
  (reusa `hourInTz`/`isWithinWindow` de [sendWindow](../../src/lib/sendWindow.ts)). Fora da janela o
  toque **espera** (o marcador não foi gravado) → um pós-venda "vencido às 23h" sai às 9h do dia
  seguinte. Nunca mandar "avalie a gente" de madrugada.
- **Opt-out sempre.** A query já filtra `optOut=false`; o loop **re-checa** antes de enviar (anti-corrida,
  igual `dispatchOutboundJob` [messaging.ts:364](../../src/server/services/messaging.ts#L364)). O
  **reengajamento** é cold-ish → leva o **rodapé de descadastro** (`appendOptOutFooter`, gated por
  `OUTBOUND_OPTOUT_FOOTER` [messaging.ts:40](../../src/server/services/messaging.ts#L40)). Pós-venda/NPS
  são dentro-da-relação (o cliente ACABOU de transacionar) → sem rodapé (não soa como spam).
- **`source: "SYSTEM"`** em todos os toques (automatismo, não resposta da IA — não infla a métrica de
  IA), igual os lembretes.
- **Reengajamento só de quem engajou e esfriou.** Filtro: teve **inbound** algum dia, **sem inbound**
  nos últimos N dias, `status ∈ {EM_CONVERSA, QUALIFICADO, OFERTA_ENVIADA}` (não NOVO/PAGO/DESCARTADO),
  `aiPaused=false` (não atropelar handoff humano), **sem comanda FECHADA recente** (quem acabou de
  comprar não é "frio"), e `lastEngagedAt` nulo ou antigo (não re-tocar o mesmo frio toda semana).
  Cap por tick (bounded) p/ não blastar.

**Escopo (o que NÃO entra no v1):**
- **Templates customizáveis por conta** — v1 usa os textos padrão com `{{nome}}`. Override por conta
  (igual `reminderDayBeforeTemplate` do número) é follow-up.
- **Pós-venda do funil Pix puro (`Lead.status=PAGO` SEM comanda)** — v1 ancora só em `Order` FECHADA.
  Lead que pagou por Pix sem gerar comanda não recebe pós-venda/NPS (mas o **reengajamento** o pega se
  esfriar). Ancorar também em `Lead.status=PAGO` (com marcador próprio no Lead) é follow-up documentado.
- **NPS estruturado (coletar a nota 0–10 de volta e tabular)** — v1 só **pergunta**. Capturar e
  reportar a resposta é follow-up (viraria um model `Survey`/`NpsResponse`).
- **Cadência multi-toque de win-back** (1º toque D+7, 2º D+21…) — v1 é **um** toque por esfriamento,
  com re-throttle por `lastEngagedAt`. Sequência é follow-up.
- **Reengajamento de quem nunca respondeu (NOVO puro)** — v1 exige inbound prévio (win-back de quem
  conversou), não prospecção fria de contato que nunca falou.

---

## Coordenação (Onda E — compartilhada com a iniciativa 7, IA tool-calling)

- **Schema (Onda E):** a iniciativa 7 é dona de **`prisma/manual/2026-07-08-onda-e.sql`** (flag por
  número + `MediaAsset`) e **já deixou o gancho**: o cabeçalho do arquivo (linha 2) diz "*Iniciativa 10
  (automação) ACRESCENTA Lead.lastEngagedAt neste mesmo arquivo — não sobrescreva, compõe*". Esta
  iniciativa **ACRESCENTA** ao **mesmo** arquivo a seção de automação (`Lead.lastEngagedAt` +
  `Order.postSaleThankedAt`/`reviewRequestedAt` + `User.lifecycleAutomationEnabled`) — **compõe, não
  sobrescreve** (padrão estoque×despesas na Onda A, comissão×booking na Onda F). Tudo `IF NOT EXISTS`
  → a ordem de aplicação não importa. [[prod-schema-drift-destravar]]
- **Sem sobreposição de código com a iniciativa 7:** ela vive em `conversation.service`/`ai/provider`/
  `ai/prompts` e no `MediaAsset`; esta vive em `lifecycle.ts` / `lifecycle-automation.ts` / um tick novo
  no `run.ts` / uma toggle nas Configurações. **Nenhum arquivo em comum** exceto o `onda-e.sql` (regra
  de append acima), o `env.ts` (blocos de env distintos) e o **mestre** (atualizar no fim).
- **Depende de nada duro:** roda no worker sem a iniciativa 7. Casa bem com tool-calling (a IA poderia
  disparar toques), mas o worker os dispara sozinho. `Order`/`Lead`/`Message`/`sendWhatsAppMessage` já
  existem e estão deployados. `Appointment.orderId` (comanda do REALIZADO) é da Onda C, **já em PROD**
  ([[agenda-pro-feito]]) — mas o v1 nem precisa lê-lo (ancora direto na comanda FECHADA).
- Regra de ouro ([[prod-schema-drift-destravar]]): em dev é `db push` (**pare o `next dev`** — EPERM no
  rename da DLL do query-engine [[prisma-generate-dev-server-lock]]); em PROD é **só** o `manual/*.sql`
  idempotente aplicado pelo dono no Supabase SQL Editor. **Nunca** duplicar manual × migration.

---

## Contexto do código existente (leia antes de começar)

- **Padrão idempotente de janela (a espinha dorsal deste plano):**
  [meeting-reminders.ts](../../src/server/services/meeting-reminders.ts) — `dueReminder` é **PURA**
  (decide o toque given `scheduledAt`/`now`/marcadores), `dispatchDueReminders`
  ([:102](../../src/server/services/meeting-reminders.ts#L102)) varre, envia por `sendWhatsAppMessage`
  com `{ source: "SYSTEM" }` e **só marca o timestamp após enviar**
  ([:154](../../src/server/services/meeting-reminders.ts#L154)); falha loga e retenta no próximo tick.
  `appointment-reminders.ts` é o mesmo padrão reusando a pura. **Copie fielmente.**
- **Envio reativo (fonte única):** `sendWhatsAppMessage(lead, text, { source })`
  [messaging.ts:84](../../src/server/services/messaging.ts#L84) — resolve o chip (o da conversa; senão
  qualquer um CONNECTED/WARMING da conta), envia (baileys/mock/cloud), persiste `Message(OUTBOUND)`,
  toca `updatedAt` e invalida o cache da conversa. `source` default `AI`; passe **`SYSTEM`**.
- **Rodapé LGPD (puro):** `appendOptOutFooter(content, footer)`
  [messaging.ts:40](../../src/server/services/messaging.ts#L40) — no-op se vazio ou já presente. O texto
  vem de `env.OUTBOUND_OPTOUT_FOOTER_TEXT`, gated por `env.OUTBOUND_OPTOUT_FOOTER`
  [env.ts:53](../../src/lib/env.ts#L53).
- **Loop do worker:** [run.ts:148](../../src/server/worker/run.ts#L148) — laço `while(true)` com ticks
  throttled por `Date.now() - lastX >= INTERVALO`. O bloco de lembretes
  ([:181](../../src/server/worker/run.ts#L181)) e o de retenção de mídia
  ([:203](../../src/server/worker/run.ts#L203), env-gated off por default) são o **molde exato** do
  tick novo. `hourInTz`/`isWithinWindow` já importados ([:3](../../src/server/worker/run.ts#L3)).
- **Retenção de mídia (molde do "sobe inerte, liga por env"):**
  [media-retention.ts:23](../../src/server/services/media-retention.ts#L23) — `if (days <= 0) return 0`,
  `BATCH`/`MAX_BATCHES` bounded por execução. Espelhe no reengajamento (cap por tick).
- **Model `Order`:** [schema.prisma:375](../../prisma/schema.prisma#L375) — `status` (`FECHADA`),
  `closedAt`, `leadId?`. Ganha `postSaleThankedAt`/`reviewRequestedAt`. Índice
  `@@index([accountId, closedAt])` já existe ([:414](../../prisma/schema.prisma#L414)) — a varredura
  por janela é barata.
- **Model `Lead`:** [schema.prisma:648](../../prisma/schema.prisma#L648) — tem `optOut`/`optOutAt`,
  `status` (LeadStatus [:571](../../prisma/schema.prisma#L571)), `aiPaused`, `messages Message[]`,
  `orders Order[]`, `whatsAppNumberId`, `updatedAt`. Ganha `lastEngagedAt`. **Sem** coluna de
  "último inbound" — o filtro relacional `messages: { none/some }` resolve (ver Fase 3).
- **Model `User`:** [schema.prisma:122](../../prisma/schema.prisma#L122) — bloco de config do dono
  (`bookingEnabled` etc. [:164](../../prisma/schema.prisma#L164)) é o vizinho natural do toggle novo.
- **`sendWindow`:** `hourInTz(now, tz)` + `isWithinWindow(hour, { startHour, endHour })` — usados no
  gate de disparo do worker ([run.ts:265](../../src/server/worker/run.ts#L265)).
- **Configurações:** `src/app/(app)/configuracoes/page.tsx` monta as seções (é onde vive o toggle de
  booking/SLA). A toggle "Automações de ciclo de vida" entra aqui, gate de dono (`canSettings`).
- **Tenancy:** conta = `User` dono (`ctx.tenantUserId`); operador = `ctx.sessionUserId`. O toggle é
  **de dono** (`ctx.perms.canSettings`).

---

## Visão geral das fases

> **Ordem por dependência, não pela numeração do mestre.** O motor puro (Fase 2) não depende de nada.
> Cada fase é entregável: até a Fase 4, **nada dispara** (schema + motor existem, inertes). Zero impacto
> em produção até o tick ser ligado no worker E as duas chaves (env global + opt-in por conta) estarem
> `true`.

- **Fase 1** — Onda E (schema, append): `Lead.lastEngagedAt` + `Order.postSaleThankedAt`/
  `reviewRequestedAt` + `User.lifecycleAutomationEnabled`; `db push`; **append** no `onda-e.sql`.
- **Fase 2** — Motor **PURO** (TDD) em `lifecycle.ts`: `isDueAfter` + templates/render. Sem DB.
- **Fase 3** — `lifecycle-automation.ts` (varre → envia → marca) com os 3 sub-passes, TDD de integração
  (banco de teste). Idempotente, opt-out, window, cap.
- **Fase 4** — Wire no worker (`run.ts`, tick throttled) + env flags. Ainda off por default.
- **Fase 5** — UI: toggle "Automações de ciclo de vida" nas Configurações (opt-in por conta) + API.
- **Fase 6** — Verificação E2E (dev) + rollout PROD (append do SQL + deploy + como ligar com segurança).

---

# FASE 1 — Onda E: schema da automação (append no arquivo compartilhado)

Objetivo: criar as colunas, sem nenhum comportamento novo. Idempotente e composto com a iniciativa 7.

## Task 1.1: marcadores de idempotência + opt-in por conta

**Files:** Modify `prisma/schema.prisma`; Modify `prisma/manual/2026-07-08-onda-e.sql`.

**Step 1: adicione as colunas ao schema**

Em `Lead` (perto de `optOut`/`updatedAt`):

```prisma
  // Reengajamento (ciclo de vida): última vez que uma automação de win-back tocou
  // este lead. Evita re-tocar o mesmo frio toda semana. null = nunca tocado.
  lastEngagedAt     DateTime?
```

Em `Order` (perto de `closedAt`):

```prisma
  // Automação de ciclo de vida (marcadores de janela idempotente, gravados só APÓS
  // o envio — igual remindedDayBeforeAt/HourBeforeAt do lembrete). null = ainda não
  // enviado. Pós-venda e pedido de avaliação (NPS) ancoram nesta comanda FECHADA.
  postSaleThankedAt DateTime?
  reviewRequestedAt DateTime?
```

Em `User` (junto do bloco de config do dono, perto de `bookingEnabled`):

```prisma
  // Opt-in por conta das automações de ciclo de vida (pós-venda, avaliação,
  // reengajamento). default false: nada dispara para o cliente do dono sem ele
  // ligar. Combinado com o kill-switch global de ambiente (LIFECYCLE_AUTOMATION).
  // Só faz sentido no dono (ownerId=null).
  lifecycleAutomationEnabled Boolean @default(false)
```

**Step 2: `db push` + validate**

> ⚠️ Pare o `next dev` antes ([[prisma-generate-dev-server-lock]]).

```bash
npx prisma validate
npx prisma db push
```

**Step 3: append no `onda-e.sql` (compõe com a iniciativa 7 — NÃO sobrescreva)**

Acrescente ao **final** do arquivo (o cabeçalho dele já prevê este append):

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Onda E · Iniciativa 10 (automação de ciclo de vida) — ACRESCENTADO ao arquivo
-- compartilhado com a iniciativa 7 (IA tool-calling). NÃO sobrescreva; compõe.
-- Tudo IF NOT EXISTS → ordem de aplicação não importa. [[prod-schema-drift-destravar]]
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Lead"  ADD COLUMN IF NOT EXISTS "lastEngagedAt"     TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "postSaleThankedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "User"  ADD COLUMN IF NOT EXISTS "lifecycleAutomationEnabled" BOOLEAN NOT NULL DEFAULT false;
```

> Sem índice novo: a varredura de pós-venda/NPS reusa `@@index([accountId, closedAt])` já existente; o
> reengajamento é bounded por `take` e filtrado por relação. **Não** rode este SQL em dev (lá é
> `db push`); ele é só p/ PROD (Task 6.2).

**Step 4: commit**

```bash
git add prisma/schema.prisma prisma/manual/2026-07-08-onda-e.sql
git commit -m "feat(lifecycle): marcadores de automação + opt-in por conta (Onda E, append)"
```

> **Desvio consciente do mestre:** o mestre previa "sem schema novo obrigatório" + "eventual
> `Lead.lastEngagedAt`". Acrescentamos **3 colunas de marcador** (`Lead.lastEngagedAt`,
> `Order.postSaleThankedAt`, `Order.reviewRequestedAt`) — sem elas não há como o toque ser idempotente
> (o padrão do codebase é marcador de janela, não re-derivar de `Message` por conteúdo, que é frágil) —
> e **`User.lifecycleAutomationEnabled`** — sem opt-in por conta, um flag global mandaria mensagem ao
> cliente de TODA conta (viola o princípio "opt-in por conta" do mestre e é temerário num multi-tenant).
> O mestre é atualizado na Task 6.3.

---

# FASE 2 — Motor de ciclo de vida (PURO, TDD)

Objetivo: **decidir** e **renderizar** sem tocar no banco. Tudo em `src/lib/lifecycle.ts`. É o que mais
precisa de teste (janela, piso, marcador já-enviado) e o que menos muda.

## Task 2.1: `isDueAfter` + templates/render — TDD

**Files:** Create `src/lib/lifecycle.ts`; Create `src/lib/lifecycle.test.ts`.

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  isDueAfter,
  renderLifecycleTemplate,
  postSaleMessage,
  reviewMessage,
  reengageMessage,
} from "./lifecycle";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-07-08T15:00:00.000Z");
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);

describe("isDueAfter", () => {
  const base = { now, delayMs: 2 * HOUR, floorMs: 7 * 24 * HOUR, marker: null as Date | null };
  it("evento há 3h, atraso 2h, sem marcador → devido", () => {
    expect(isDueAfter({ ...base, eventAt: at(-3 * HOUR) })).toBe(true);
  });
  it("evento há 1h, atraso 2h → ainda NÃO (não passou o atraso)", () => {
    expect(isDueAfter({ ...base, eventAt: at(-1 * HOUR) })).toBe(false);
  });
  it("já enviado (marcador setado) → não repete", () => {
    expect(isDueAfter({ ...base, eventAt: at(-3 * HOUR), marker: now })).toBe(false);
  });
  it("evento antigo demais (antes do piso) → não toca backlog", () => {
    expect(isDueAfter({ ...base, eventAt: at(-10 * 24 * HOUR) })).toBe(false);
  });
  it("evento no futuro → nunca", () => {
    expect(isDueAfter({ ...base, eventAt: at(1 * HOUR) })).toBe(false);
  });
  it("atraso 0 (desligado) já é tratado FORA (o service nem chama); guard defensivo", () => {
    // com delayMs=0 e evento no passado, é devido — o gate de ligado/desligado é do service
    expect(isDueAfter({ ...base, delayMs: 0, eventAt: at(-1 * HOUR) })).toBe(true);
  });
});

describe("renderLifecycleTemplate", () => {
  it("substitui {{nome}} pelo primeiro nome", () => {
    expect(renderLifecycleTemplate("Oi, {{nome}}!", { nome: "Ana Paula" })).toBe("Oi, Ana Paula!");
  });
});

describe("mensagens", () => {
  it("pós-venda usa o primeiro nome", () => {
    expect(postSaleMessage({ name: "João Silva" })).toContain("João");
  });
  it("NPS pergunta a nota", () => {
    expect(reviewMessage({ name: "Maria" }).toLowerCase()).toMatch(/0 a 10|recomend/);
  });
  it("reengajamento é win-back", () => {
    expect(reengageMessage({ name: "Zé" })).toContain("Zé");
  });
});
```

**Step 2: Run test to verify it fails**

`npx vitest run src/lib/lifecycle.test.ts` → FAIL (módulo/exports não existem).

**Step 3: Write minimal implementation**

```ts
// src/lib/lifecycle.ts — decisões PURAS + textos das automações de ciclo de vida.
// Espelha a disciplina de dueReminder: decisão de janela given timestamps, sem DB.

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** PURA: um evento (comanda fechada, etc.) com marcador NULO está devido AGORA?
 *  Devido = passou o atraso (now - eventAt >= delayMs) E não é backlog antigo
 *  (now - eventAt <= floorMs) E ainda não foi enviado (marker == null) E o evento
 *  não está no futuro. O gate ligado/desligado (delay 0) é do service, não daqui. */
export function isDueAfter(input: {
  eventAt: Date;
  now: Date;
  delayMs: number;
  floorMs: number;
  marker: Date | null;
}): boolean {
  if (input.marker) return false;
  const age = input.now.getTime() - input.eventAt.getTime();
  if (age < input.delayMs) return false; // ainda não passou o atraso (cobre futuro: age<0)
  if (age > input.floorMs) return false; // antigo demais → não tocar o passado ao ligar
  return true;
}

/** PURA: renderiza {{nome}} (primeiro nome). Base p/ futuros placeholders. */
export function renderLifecycleTemplate(template: string, vars: { nome: string }): string {
  return template.replace(/\{\{\s*nome\s*\}\}/gi, vars.nome).trim();
}

// Textos padrão (v1 sem override por conta). Neutros de gênero/ramo.
export const DEFAULT_POSTSALE =
  "Oi, {{nome}}! Obrigado pela preferência 🙌 Foi um prazer te atender. Qualquer coisa, é só chamar!";
export const DEFAULT_REVIEW =
  "Oi, {{nome}}! Como foi sua experiência com a gente? De 0 a 10, o quanto você nos recomendaria? Sua resposta ajuda demais 🙏";
export const DEFAULT_REENGAGE =
  "Oi, {{nome}}! Faz um tempinho que a gente não se fala. Posso te ajudar em alguma coisa? 😊";

export const postSaleMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_POSTSALE, { nome: firstName(lead.name) });
export const reviewMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_REVIEW, { nome: firstName(lead.name) });
export const reengageMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_REENGAGE, { nome: firstName(lead.name) });
```

**Step 4: Run test to verify it passes** → PASS.

**Step 5: commit**

```bash
git add src/lib/lifecycle.ts src/lib/lifecycle.test.ts
git commit -m "feat(lifecycle): motor puro isDueAfter + templates (TDD)"
```

> **Fim da Fase 2:** dado um evento e os parâmetros de janela, o sistema sabe se/qual toque enviar,
> 100% testável, sem DB.

---

# FASE 3 — Serviço de dispatch (efeito) + idempotência

Objetivo: `dispatchLifecycleAutomations(now)` que varre → envia → marca, com os 3 sub-passes. Copia o
padrão de `dispatchDueReminders` (marca só após enviar). No-op total se o kill-switch global estiver off.

## Task 3.1: env flags da automação

**Files:** Modify `src/lib/env.ts`.

Adicione um bloco (perto do de retenção de mídia — mesma família "sobe inerte, liga por env"):

```ts
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
```

Commit junto com a Task 3.2 (o serviço consome estas envs).

## Task 3.2: `lifecycle-automation.ts` — dispatch (TDD de integração)

**Files:** Create `src/server/services/lifecycle-automation.ts`; Test co-locado
`src/server/services/lifecycle-automation.test.ts`.

**Contrato:**
```ts
export async function dispatchLifecycleAutomations(now: Date): Promise<number>;
// exportadas p/ teste isolado dos 3 passes:
export async function dispatchPostSale(now: Date): Promise<number>;
export async function dispatchReviewRequests(now: Date): Promise<number>;
export async function dispatchReengagement(now: Date): Promise<number>;
```

**Comportamento (espelha `dispatchDueReminders`):**
- `dispatchLifecycleAutomations`: se `!env.LIFECYCLE_AUTOMATION` → `return 0` (kill-switch). Se **fora da
  janela** comercial (`isWithinWindow(hourInTz(now, TZ), { startHour, endHour })`) → `return 0` (espera).
  Senão chama os 3 sub-passes, cada um em **try/catch próprio** (falha de um não derruba os outros,
  igual reunião×agendamento no `run.ts`), soma e retorna.
- **`dispatchPostSale`** (só se `LIFECYCLE_POSTSALE_HOURS > 0`): varre
  ```ts
  prisma.order.findMany({
    where: {
      status: "FECHADA",
      leadId: { not: null },
      closedAt: { not: null },
      postSaleThankedAt: null,
      lead: { optOut: false },
      account: { lifecycleAutomationEnabled: true }, // opt-in por conta (Order.account = dono)
    },
    select: { id, closedAt, lead: { select: { id, name, phone, userId, whatsAppNumberId, optOut } } },
    take: BATCH, orderBy: { closedAt: "asc" },
  })
  ```
  Para cada: `isDueAfter({ eventAt: closedAt, now, delayMs: HOURS*H, floorMs: FLOOR_DAYS*D, marker: null })`
  (o `null` do marcador já veio filtrado; passar `postSaleThankedAt` mantém a pura como fonte da
  decisão). Se devido e `!lead.optOut` (re-check): `sendWhatsAppMessage(lead, postSaleMessage(lead),
  { source: "SYSTEM" })` → **depois** `order.update({ postSaleThankedAt: now })`. Falha → loga, não
  marca, retenta. **SEM** rodapé (dentro-da-relação).
- **`dispatchReviewRequests`** (só se `LIFECYCLE_REVIEW_HOURS > 0`): idêntico, marcador
  `reviewRequestedAt`, texto `reviewMessage`, atraso `REVIEW_HOURS`. (Pós-venda e NPS são independentes:
  a mesma comanda pode receber os dois, em horas diferentes.)
- **`dispatchReengagement`** (só se `LIFECYCLE_REENGAGE_DAYS > 0`): "frio" = engajou e sumiu:
  ```ts
  const coldCutoff = new Date(now - DAYS*D);
  prisma.lead.findMany({
    where: {
      optOut: false,
      aiPaused: false,
      status: { in: ["EM_CONVERSA", "QUALIFICADO", "OFERTA_ENVIADA"] },
      user: { lifecycleAutomationEnabled: true },
      OR: [{ lastEngagedAt: null }, { lastEngagedAt: { lt: coldCutoff } }], // não re-tocar frio recente
      AND: [
        { messages: { some: { direction: "INBOUND", createdAt: { lt: coldCutoff } } } }, // engajou algum dia
        { messages: { none: { direction: "INBOUND", createdAt: { gte: coldCutoff } } } }, // sem inbound recente
        { orders: { none: { status: "FECHADA", closedAt: { gte: coldCutoff } } } }, // não comprou há pouco
      ],
    },
    select: { id, name, phone, userId, whatsAppNumberId, optOut },
    take: BATCH, orderBy: { updatedAt: "asc" },
  })
  ```
  Para cada (re-check `!optOut`): texto = `appendOptOutFooter(reengageMessage(lead),
  env.OUTBOUND_OPTOUT_FOOTER ? env.OUTBOUND_OPTOUT_FOOTER_TEXT : "")` (win-back é cold-ish → rodapé) →
  `sendWhatsAppMessage(lead, texto, { source: "SYSTEM" })` → `lead.update({ lastEngagedAt: now })`.
  `BATCH` bounded por tick (const, ex.: 50) p/ não blastar ao ligar — loga quando satura o lote.
- `TZ = env.SCHEDULING_TIMEZONE`; consts `HOUR_MS`/`DAY_MS`/`BATCH` no topo (igual media-retention).

**Step 1: Write the failing test** (banco de teste; mesmo estilo de `order.service.test.ts`; força as
envs relevantes por `vi.stubEnv`/mock do módulo `env` — ver como os testes existentes injetam env)

```ts
describe("lifecycle-automation", () => {
  it("no-op quando o kill-switch global está off", async () => {
    // LIFECYCLE_AUTOMATION=false → 0, mesmo com comanda devida
    expect(await dispatchLifecycleAutomations(now)).toBe(0);
  });
  it("pós-venda: comanda FECHADA há 3h (atraso 2h) → 1 envio + marca postSaleThankedAt", async () => {
    // seed: conta com lifecycleAutomationEnabled=true, lead, comanda FECHADA closedAt=now-3h
    const n = await dispatchPostSale(now);
    expect(n).toBe(1);
    const o = await prisma.order.findUnique({ where: { id: orderId } });
    expect(o?.postSaleThankedAt).not.toBeNull();
  });
  it("pós-venda NÃO repete (idempotente entre ticks)", async () => {
    await dispatchPostSale(now); // marca
    expect(await dispatchPostSale(new Date(now.getTime() + 60_000))).toBe(0);
  });
  it("pós-venda pula conta sem opt-in (lifecycleAutomationEnabled=false)", async () => {
    expect(await dispatchPostSale(now)).toBe(0);
  });
  it("pós-venda pula comanda avulsa (leadId null) e lead em opt-out", async () => { /* … */ });
  it("pós-venda respeita o piso anti-backlog (comanda de 10 dias, floor 7) → 0", async () => { /* … */ });
  it("NPS é independente do pós-venda (mesma comanda, marcador reviewRequestedAt)", async () => { /* … */ });
  it("reengajamento: lead com inbound há 10d e sem inbound recente → 1 envio + lastEngagedAt", async () => { /* … */ });
  it("reengajamento pula lead com inbound recente, opt-out, aiPaused, status PAGO/DESCARTADO", async () => { /* … */ });
  it("reengajamento pula lead com comanda FECHADA recente (não é frio)", async () => { /* … */ });
  it("reengajamento aplica o rodapé de opt-out no texto", async () => { /* … */ });
  it("fora da janela comercial → 0 (espera; não marca)", async () => { /* … */ });
});
```

**Step 2 / 3 / 4:** rode (FAIL), implemente o serviço, rode (PASS).

**Step 5: commit**

```bash
git add src/lib/env.ts src/server/services/lifecycle-automation.ts src/server/services/lifecycle-automation.test.ts
git commit -m "feat(lifecycle): serviço de dispatch (pós-venda/NPS/reengajamento) idempotente + env (TDD)"
```

> **Fim da Fase 3:** o serviço sabe varrer, enviar e marcar — mas **ninguém o chama** ainda (o worker é a
> Fase 4). Zero impacto.

---

# FASE 4 — Wire no worker

Objetivo: o worker chama o dispatch num tick throttled. Ainda off por default (env + conta).

## Task 4.1: tick de ciclo de vida no loop do worker

**Files:** Modify `src/server/worker/run.ts`.

- Importe `dispatchLifecycleAutomations`.
- Declare `let lastLifecycle = 0;` junto dos outros `lastX` ([:143](../../src/server/worker/run.ts#L143)).
- Adicione o tick (molde exato do bloco de lembretes/retenção), depois do bloco de retenção de mídia:

```ts
    // Automação de ciclo de vida (pós-venda / NPS / reengajamento de frio). O
    // serviço é no-op se LIFECYCLE_AUTOMATION=false (kill-switch) ou fora da janela
    // comercial. Throttle próprio (default 15 min): a granularidade é hora/dia, não
    // precisa rodar a cada poll. Roda nos dois modos (envio por chip no baileys,
    // Graph no cloud).
    if (Date.now() - lastLifecycle >= env.LIFECYCLE_EVERY_MS) {
      try {
        const n = await dispatchLifecycleAutomations(new Date());
        if (n > 0) logger.info({ sent: n }, "[worker] automações de ciclo de vida enviadas");
      } catch (err) {
        logger.error({ err }, "[worker] dispatchLifecycleAutomations falhou");
      }
      lastLifecycle = Date.now();
    }
```

- Verifique `npx tsc --noEmit`. Commit.

```bash
git add src/server/worker/run.ts
git commit -m "feat(lifecycle): tick de automação de ciclo de vida no worker (env-gated off)"
```

> **Fim da Fase 4:** o worker dispara os toques quando ligado. Nada muda em PROD até `LIFECYCLE_AUTOMATION`
> **e** o opt-in da conta estarem `true`.

---

# FASE 5 — UI (opt-in por conta)

## Task 5.1: API do toggle de automação (dono)

**Files:** Create/Modify a rota de settings da conta (reusar a existente que já grava campos do dono —
ex.: onde `bookingEnabled`/`inboxSlaMinutes` são salvos; **não** criar rota nova se já há um PATCH de
Configurações da conta).

- `getTenantContext` → 401; **403 se `!ctx.perms.canSettings`** (config de dono); zod
  `{ lifecycleAutomationEnabled: z.boolean() }`; grava em `ctx.tenantUserId`. Commit.

```bash
git add src/app/api/...  # a rota de settings da conta tocada
git commit -m "feat(lifecycle): API do opt-in de automação por conta (dono)"
```

## Task 5.2: UI — toggle nas Configurações

**Files:** Modify `src/app/(app)/configuracoes/page.tsx` (ou o componente de seção de conta já usado
para booking/SLA); se precisar de client component, criar `src/components/app/LifecycleSettings.tsx`.

- Seção "Automações de ciclo de vida" (gate de dono): um switch **"Ativar pós-venda, avaliação e
  reengajamento automáticos"** ligado a `lifecycleAutomationEnabled`, com um parágrafo curto explicando
  o que dispara (e que respeita opt-out/LGPD). Texto secundário: "As mensagens saem só em horário
  comercial." Só tokens/CSS vars ([[design-tokens-dark-theme]]). Verificação visual + commit.

```bash
git add src/app/(app)/configuracoes/page.tsx src/components/app/LifecycleSettings.tsx
git commit -m "feat(lifecycle): seção de automações de ciclo de vida nas Configurações"
```

> **Fim da Fase 5:** o dono liga/desliga a automação da própria conta. Quais toques (pós-venda/NPS/
> reengajamento) e com que atraso é definido pelo operador da plataforma via env (kill-switch + horas/
> dias). Custom por conta é follow-up.

---

# FASE 6 — Verificação de ponta a ponta + rollout

## Task 6.1: Verificação E2E (dev)

Com `LIFECYCLE_AUTOMATION=true`, `LIFECYCLE_POSTSALE_HOURS=2`, `LIFECYCLE_REVIEW_HOURS=24`,
`LIFECYCLE_REENGAGE_DAYS=7` no `.env` do worker e uma conta com `lifecycleAutomationEnabled=true`
(ligar pela UI da Task 5.2):

1. **Pós-venda:** fechar uma comanda ligada a um lead; adiantar `closedAt` para ~3h atrás (SQL direto no
   dev), rodar o worker (ou chamar `dispatchLifecycleAutomations(new Date())` num script) → o lead recebe
   o "obrigado", `Order.postSaleThankedAt` preenchido. Rodar de novo → **não** reenvia.
2. **NPS:** adiantar `closedAt` para ~25h atrás → recebe o pedido de avaliação, `reviewRequestedAt`
   preenchido (independente do pós-venda).
3. **Reengajamento:** um lead com uma mensagem INBOUND datada de ~10 dias atrás, `status=EM_CONVERSA`,
   sem inbound recente e sem comanda recente → recebe o win-back **com rodapé de opt-out**,
   `lastEngagedAt` preenchido. Um lead `optOut=true` ou com inbound recente → **não** recebe.
4. **Opt-in por conta:** desligar `lifecycleAutomationEnabled` da conta → **nada** dispara (mesmo com as
   envs ligadas). Kill-switch global `LIFECYCLE_AUTOMATION=false` → nada dispara para ninguém.
5. **Janela:** simular `now` fora de `WHATSAPP_SEND_START_HOUR..END_HOUR` → `dispatch` retorna 0 e **não**
   marca (o toque sai no próximo tick dentro da janela).
6. `npx vitest run src/lib/lifecycle.test.ts src/server/services/lifecycle-automation.test.ts` verde +
   `npx tsc --noEmit` limpo.

## Task 6.2: Rollout PROD

- Aplicar a **seção da iniciativa 10 do `2026-07-08-onda-e.sql`** no Supabase SQL Editor (idempotente; se
  a iniciativa 7 já compôs o arquivo, aplicar o arquivo inteiro — tudo `IF NOT EXISTS`). **Não** duplicar
  com migration versionada ([[prod-schema-drift-destravar]]). Env do DB é Sensitive e não alcança daqui —
  aplicar pelo painel.
- Deploy web via CLI com token do time matheus-projects ([[vercel-hobby-push-block]];
  `env -u CLAUDECODE CI=1 npx vercel deploy --prod`) — leva a toggle das Configurações.
- **Worker (Oracle):** `git pull` + `systemctl restart crm-worker` (leva o tick novo)
  ([[worker-oracle-update-procedure]]). O tick sobe **inerte** (`LIFECYCLE_AUTOMATION` ausente = false).
- **Ligar com segurança (gradual):** primeiro deixar as envs OFF; ligar `LIFECYCLE_AUTOMATION=true` +
  `LIFECYCLE_POSTSALE_HOURS=2` numa janela de teste com **uma** conta piloto que ligou o opt-in; observar
  o log `[worker] automações ... enviadas` e a conversa do lead; só então subir NPS/reengajamento e abrir
  para mais contas. **Reengajamento por último** (é o cold-ish — vigiar opt-out/reação
  [[product-readiness-baseline]], [[pricing-plans-cost]] p/ custo de token).
- Smoke PROD: conta piloto com opt-in → fechar comanda com lead, adiantar `closedAt`, confirmar 1 envio e
  o marcador. `/configuracoes` sem 500 (coluna nova no `User`).

## Task 6.3: Atualizar o mestre

**Files:** Modify `docs/plans/2026-07-05-roadmap-multinegocio.md`.

- Na tabela de iniciativas (linha 50), apontar este plano (`2026-07-08-automacao-ciclo-vida.md`) como
  **escrito / pronto p/ executar** (depois **FEITO (dev)** quando implementado).
- Na descrição da Onda E (linha ~78), registrar o **desvio consciente**: além do previsto
  `Lead.lastEngagedAt`, a automação acrescenta **`Order.postSaleThankedAt`/`reviewRequestedAt`**
  (marcadores de idempotência) e **`User.lifecycleAutomationEnabled`** (opt-in por conta) — necessários
  p/ o toque ser idempotente e o disparo ser opt-in num multi-tenant. Tudo append no `onda-e.sql`.
- Commit.

```bash
git add docs/plans/2026-07-05-roadmap-multinegocio.md docs/plans/2026-07-08-automacao-ciclo-vida.md
git commit -m "docs(roadmap): plano da iniciativa 10 (automação de ciclo de vida) + desvio da Onda E"
```

---

## Riscos e notas

- **Duas chaves, off por padrão** — a decisão-âncora de segurança. Kill-switch global de ambiente
  (`LIFECYCLE_AUTOMATION`) **e** opt-in por conta (`lifecycleAutomationEnabled`). Num multi-tenant, um
  flag só mandaria mensagem ao cliente de todas as contas. Ligar gradual (piloto → NPS → reengajamento).
- **Idempotência é o coração** — marcador de janela gravado **só após enviar** (igual reminders). Falha
  no envio não marca → retenta no próximo tick. Nunca dois "obrigado" pela mesma comanda.
- **Cold outbound (reengajamento)** — é o toque mais sensível legalmente ([[product-readiness-baseline]]:
  furo de cold-outbound). Só de quem **engajou** (inbound prévio) e esfriou; `optOut` respeitado
  (query + re-check); **rodapé de descadastro** anexado; `aiPaused=false` (não atropela handoff). Sai
  por último no rollout.
- **Âncora única (Order FECHADA)** — pós-venda/NPS ancoram na comanda fechada; agendamento REALIZADO
  converge nela (`Appointment.orderId`). Evita mensagem dupla. Funil Pix puro (`Lead.status=PAGO` sem
  comanda) fica de fora do pós-venda no v1 (mas o reengajamento o pega se esfriar) — follow-up.
- **Janela comercial** — nenhum toque de madrugada; fora da janela o dispatch retorna 0 e o toque espera
  o próximo tick dentro do horário. O marcador não é gravado, então nada se perde.
- **Custo da varredura no worker** — pós-venda/NPS reusam `@@index([accountId, closedAt])`; o
  reengajamento é bounded por `take`/BATCH e roda a cada 15 min (não a cada poll). O filtro relacional
  `messages: { some/none }` é o ponto a vigiar em escala — se pesar, materializar um `Lead.lastInboundAt`
  (atualizado no ingest) é a otimização (não requisito do v1).
- **Custo de token** — reengajamento gera OUTBOUND que pode iniciar conversa (a IA responde ao retorno);
  vigiar volume ([[pricing-plans-cost]], [[ai-context-and-media-policy]]).
- **Onda E compartilhada com a iniciativa 7** — respeitar o **append** no `onda-e.sql` (o cabeçalho dele
  já prevê `Lead.lastEngagedAt`); nunca duplicar manual × migration ([[prod-schema-drift-destravar]]). A
  ordem de execução das duas iniciativas não importa (tudo `IF NOT EXISTS`).
- **Sem opt-in, sem ônus** — conta que não liga `lifecycleAutomationEnabled` fecha comandas e conversa
  exatamente como antes; nenhum toque sai, seção é só um switch desligado. Opt-in de fato.
