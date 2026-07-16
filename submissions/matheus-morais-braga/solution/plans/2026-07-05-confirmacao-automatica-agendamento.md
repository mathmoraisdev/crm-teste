# Confirmação automática de agendamento por resposta do cliente + alerta na Agenda

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Quando o cliente responder ao lembrete de agendamento ("pode confirmar" / "não vou poder"), a IA interpreta a resposta, move o `Appointment` para `CONFIRMADO` ou `CANCELADO` automaticamente, registra o motivo, e acende um badge no item **Agenda** do menu para a equipe revisar.

**Architecture:** Espelha o padrão já existente de agendamento de reunião (`interpretAndBook`/`interpretSlotChoice` com o modelo barato + tool-call forçado). Um novo passo em `respondToLead` roda ANTES da qualificação: se o lead tem agendamento futuro com lembrete já enviado, classifica a última mensagem inbound como `confirm`/`decline`/`reschedule`/`unclear` e aplica a transição. Um flag booleano `needsReview` no `Appointment` alimenta um contador (`/api/appointments/review-count`) que o badge da Sidebar consome por polling, idêntico ao badge de Atendimento.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres (Supabase) · Zod (validação de saída da IA) · Vitest · o `AiClient.forcedToolCall({ tier: "cheap" })` já usado em `interpretSlotChoice`.

**Decisões travadas (do usuário):**
- Comportamento = **aplicar + sinalizar**: a IA muda o status E gera alerta pra revisão.
- Local do badge = **Agenda**.

---

## Contexto do código existente (leia antes de começar)

- **Fluxo de inbound:** [conversation.service.ts:444-618](../../src/server/services/conversation.service.ts#L444-L618) — `respondToLead(leadId)`. O ponto de injeção é logo após o bloco de reunião `PROPOSED` (linha ~502) e ANTES da config da empresa/qualificação. Segue o mesmo formato do `interpretAndBook` chamado na linha 500.
- **Padrão de interpretação com IA:** [conversation.agent.ts:42-60](../../src/server/ai/conversation.agent.ts#L42-L60) — `interpretSlotChoice` (tool-call forçado, `tier: "cheap"`, `maxTokens: 256`, valida com zod, degrada pra "unclear" em falha). Copiar essa forma.
- **Schemas da IA:** [schemas.ts](../../src/server/ai/schemas.ts) — par zod + JSON Schema. Novo schema `apptReplySchema` mora aqui.
- **Serviço de agendamento:** [appointment.service.ts:164-210](../../src/server/services/appointment.service.ts#L164-L210) — `updateAppointment`, `cancelAppointment`, `markRealized`. As transições de status novas reaproveitam `updateAppointment`.
- **Model Prisma:** [schema.prisma:672-695](../../prisma/schema.prisma#L672-L695) — `Appointment`. Campos relevantes: `status` (`AGENDADO`/`CONFIRMADO`/`REALIZADO`/`CANCELADO`/`FALTOU`), `remindedDayBeforeAt`, `remindedHourBeforeAt`, `scheduledAt`, `leadId`.
- **Badge da Sidebar:** [Sidebar.tsx:34-58](../../src/components/app/Sidebar.tsx#L34-L58) (estado + polling) e [Sidebar.tsx:102-132](../../src/components/app/Sidebar.tsx#L102-L132) (declaração dos itens com `badge`). O tipo `NavItem.badge` na linha 17. Reaproveitar 100% o mecanismo: novo valor `"agenda"`.
- **Lembrete que marca `reminded*At`:** [appointment-reminders.ts:70-122](../../src/server/services/appointment-reminders.ts#L70-L122) — só agendamentos com `remindedDayBeforeAt` OU `remindedHourBeforeAt` != null são candidatos a receber resposta interpretável.
- **PROD tem schema drift** ([[prod-schema-drift-destravar]]): todo campo novo exige um `prisma/manual/*.sql` idempotente rodado no Supabase, senão dá 500. Ver Task 8.

**Escopo do interpretador (crítico p/ não gerar falso positivo):** só roda quando o lead tem **exatamente um** agendamento em `AGENDADO`/`CONFIRMADO`, com `scheduledAt > now`, e com lembrete já enviado (`remindedDayBeforeAt` OU `remindedHourBeforeAt` não-nulo). Se houver mais de um agendamento futuro elegível, NÃO adivinha qual — marca `needsReview=true` sem mudar status e deixa pra equipe. Se nenhum lembrete foi enviado, o passo é pulado inteiro (a mensagem segue pro fluxo normal de atendimento/qualificação).

---

## Task 1: Schema de saída da IA para classificar a resposta

**Files:**
- Modify: `src/server/ai/schemas.ts` (adicionar ao final, junto de `slotChoiceSchema`)
- Test: `src/server/ai/schemas.test.ts`

**Step 1: Write the failing test**

Em `src/server/ai/schemas.test.ts`, adicione:

```ts
import { apptReplySchema, apptReplyJsonSchema } from "./schemas";

describe("apptReplySchema", () => {
  it("aceita intents válidos com confiança", () => {
    expect(apptReplySchema.safeParse({ intent: "confirm", confident: true }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "decline", confident: false }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "reschedule", confident: true }).success).toBe(true);
    expect(apptReplySchema.safeParse({ intent: "unclear", confident: false }).success).toBe(true);
  });

  it("rejeita intent fora do enum", () => {
    expect(apptReplySchema.safeParse({ intent: "talvez", confident: true }).success).toBe(false);
  });

  it("zod e JSON Schema declaram as mesmas chaves obrigatórias", () => {
    const zodKeys = Object.keys(apptReplySchema.shape).sort();
    const jsonRequired = [...apptReplyJsonSchema.required].sort();
    expect(zodKeys).toEqual(jsonRequired);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/ai/schemas.test.ts -t apptReplySchema`
Expected: FAIL — `apptReplySchema` is not exported / undefined.

**Step 3: Write minimal implementation**

Ao final de `src/server/ai/schemas.ts`:

```ts
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/ai/schemas.test.ts -t apptReplySchema`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/server/ai/schemas.ts src/server/ai/schemas.test.ts
git commit -m "feat(agenda): schema de classificação da resposta ao lembrete"
```

---

## Task 2: Agente que classifica a resposta (modelo barato)

**Files:**
- Modify: `src/server/ai/conversation.agent.ts` (nova função + system prompt, junto de `interpretSlotChoice`)
- Test: coberto por eval opcional; a unidade real é a pureza da degradação (Task 3 testa o serviço)

**Step 1: Escreva o system prompt e a função**

Em `src/server/ai/conversation.agent.ts`, perto de `SLOT_CHOICE_SYSTEM`/`interpretSlotChoice`, adicione:

```ts
import { apptReplyJsonSchema, apptReplySchema, type ApptReply } from "./schemas";

const APPT_REPLY_SYSTEM =
  "Você classifica a resposta de um cliente a um lembrete de agendamento de serviço. " +
  "Responda SÓ com a tool. intent=confirm quando ele confirma presença (ex.: 'confirmo', 'pode marcar', 'estarei lá', 'ok', '👍'); " +
  "intent=decline quando não vai / quer desmarcar (ex.: 'não vou poder', 'cancela', 'não consigo ir'); " +
  "intent=reschedule quando quer OUTRA data/horário (ex.: 'dá pra passar pra sexta?', 'tem horário de manhã?'); " +
  "intent=unclear quando fala de outro assunto, faz pergunta, ou não dá pra saber. Na dúvida entre confirm e unclear, escolha unclear.";

/**
 * Classifica a última mensagem do cliente em relação a um agendamento já lembrado.
 * Mesma forma de `interpretSlotChoice`: tool-call forçado, modelo barato, degrada
 * para "unclear" (não-confiante) em qualquer falha — nunca deixa o fluxo travar.
 */
export async function interpretAppointmentReply(opts: {
  ai: AiClient;
  serviceName: string | null;
  whenLabel: string; // data/hora formatada do agendamento (contexto p/ a IA)
  leadMessage: string;
}): Promise<ApptReply> {
  const servico = opts.serviceName?.trim() || "atendimento";
  const input = await opts.ai.forcedToolCall({
    tier: "cheap",
    maxTokens: 256,
    system: APPT_REPLY_SYSTEM,
    user: `Agendamento: ${servico} em ${opts.whenLabel}.\n\nMensagem do cliente: "${opts.leadMessage}"`,
    toolName: "classificar_resposta",
    toolDescription: "Classifica a resposta do cliente ao lembrete de agendamento.",
    jsonSchema: apptReplyJsonSchema as unknown as Record<string, unknown>,
  });
  if (input == null) return { intent: "unclear", confident: false };
  const parsed = apptReplySchema.safeParse(input);
  return parsed.success ? parsed.data : { intent: "unclear", confident: false };
}
```

**Step 2: Verifique a compilação**

Run: `npx tsc --noEmit`
Expected: sem erros novos nesse arquivo.

**Step 3: Commit**

```bash
git add src/server/ai/conversation.agent.ts
git commit -m "feat(agenda): agente interpretAppointmentReply (modelo barato)"
```

---

## Task 3: Migration — campo `needsReview` + `reviewReason` no Appointment

**Files:**
- Modify: `prisma/schema.prisma:672-695` (model `Appointment`)
- Create: (migration gerada pelo Prisma)

**Step 1: Adicione os campos ao model**

Em `Appointment`, depois de `remindedHourBeforeAt`:

```prisma
  needsReview          Boolean           @default(false) // resposta do cliente ao lembrete aguarda conferência
  reviewReason         String? // ex.: "cliente confirmou", "cliente pediu remarcar", "cliente recusou"
```

E adicione um índice ao final do bloco `@@index`:

```prisma
  @@index([needsReview])
```

**Step 2: Gere a migration**

> ⚠️ Pare o `next dev` antes ([[prisma-generate-dev-server-lock]] — EPERM no Windows).

Run: `npx prisma migrate dev --name appointment_needs_review`
Expected: cria `prisma/migrations/<ts>_appointment_needs_review/migration.sql` e regenera o client.

**Step 3: Confirme o SQL gerado**

Abra o `migration.sql` — deve conter `ADD COLUMN "needsReview"` e `ADD COLUMN "reviewReason"` + `CREATE INDEX`. Guarde-o pra base do Task 8.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(agenda): Appointment.needsReview + reviewReason (revisão de confirmação)"
```

---

## Task 4: Serviço — aplicar a transição a partir do intent (PURO + efeito)

**Files:**
- Modify: `src/server/services/appointment.service.ts`
- Test: `src/server/services/appointment.service.test.ts`

**Step 1: Write the failing test**

Em `appointment.service.test.ts`, adicione um bloco testando a função PURA de decisão (sem banco):

```ts
import { decideApptTransition } from "./appointment.service";

describe("decideApptTransition", () => {
  it("confirm confiante → CONFIRMADO + revisão", () => {
    expect(decideApptTransition({ intent: "confirm", confident: true })).toEqual({
      status: "CONFIRMADO",
      needsReview: true,
      reviewReason: "Cliente confirmou pelo WhatsApp",
    });
  });
  it("decline confiante → CANCELADO + revisão", () => {
    expect(decideApptTransition({ intent: "decline", confident: true })).toEqual({
      status: "CANCELADO",
      needsReview: true,
      reviewReason: "Cliente recusou/desmarcou pelo WhatsApp",
    });
  });
  it("reschedule → sem mudar status, só sinaliza", () => {
    expect(decideApptTransition({ intent: "reschedule", confident: true })).toEqual({
      status: null,
      needsReview: true,
      reviewReason: "Cliente pediu para remarcar",
    });
  });
  it("não-confiante → nunca muda status, só sinaliza revisão", () => {
    expect(decideApptTransition({ intent: "confirm", confident: false })).toEqual({
      status: null,
      needsReview: true,
      reviewReason: "Resposta ambígua ao lembrete — conferir",
    });
  });
  it("unclear → nenhuma ação (null total)", () => {
    expect(decideApptTransition({ intent: "unclear", confident: true })).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t decideApptTransition`
Expected: FAIL — `decideApptTransition` não existe.

**Step 3: Write minimal implementation**

Em `appointment.service.ts` (topo, junto dos tipos), adicione a função PURA + o applier com efeito:

```ts
import type { ApptReply } from "@/server/ai/schemas";

export interface ApptTransition {
  status: "CONFIRMADO" | "CANCELADO" | null; // null = não mexe no status
  needsReview: boolean;
  reviewReason: string;
}

/**
 * PURA: traduz a classificação da resposta do cliente numa transição de status.
 * Só aplica CONFIRMADO/CANCELADO quando a IA está CONFIANTE. Qualquer dúvida
 * (reschedule, não-confiante) só acende a revisão, sem mexer no status.
 * `unclear` = a mensagem não era sobre o agendamento → nenhuma ação (null).
 */
export function decideApptTransition(reply: ApptReply): ApptTransition | null {
  if (reply.intent === "unclear") return null;
  if (!reply.confident) {
    return { status: null, needsReview: true, reviewReason: "Resposta ambígua ao lembrete — conferir" };
  }
  switch (reply.intent) {
    case "confirm":
      return { status: "CONFIRMADO", needsReview: true, reviewReason: "Cliente confirmou pelo WhatsApp" };
    case "decline":
      return { status: "CANCELADO", needsReview: true, reviewReason: "Cliente recusou/desmarcou pelo WhatsApp" };
    case "reschedule":
      return { status: null, needsReview: true, reviewReason: "Cliente pediu para remarcar" };
  }
}

/**
 * Efeito: aplica a transição decidida a um agendamento (scoping por conta).
 * Reusa a validação de posse via loadOwned.
 */
export async function applyApptTransition(userId: string, id: string, t: ApptTransition) {
  await loadOwned(userId, id);
  return prisma.appointment.update({
    where: { id },
    data: {
      ...(t.status ? { status: t.status } : {}),
      needsReview: t.needsReview,
      reviewReason: t.reviewReason,
    },
  });
}
```

> Nota: `loadOwned` já existe neste arquivo (linha ~137). `AppointmentStatus` já está importado.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t decideApptTransition`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add src/server/services/appointment.service.ts src/server/services/appointment.service.test.ts
git commit -m "feat(agenda): decideApptTransition + applyApptTransition"
```

---

## Task 5: Limpar `needsReview` quando a equipe age no card

**Files:**
- Modify: `src/server/services/appointment.service.ts` (`updateAppointment`, `cancelAppointment`, `markRealized`)
- Test: `src/server/services/appointment.service.test.ts`

**Contexto:** o badge conta `needsReview=true`. Quando a equipe clica Confirmar/Cancelar/Realizado/Faltou (os botões da ficha, que chamam esses serviços), a revisão foi feita → tem de zerar `needsReview`. Senão o badge nunca baixa.

**Step 1: Write the failing test** (integração — usa o banco de teste)

```ts
it("markRealized zera needsReview", async () => {
  // cria appt com needsReview=true (via applyApptTransition ou seed direto), depois:
  const updated = await markRealized(userId, apptId);
  expect(updated.needsReview).toBe(false);
});
```

(Replique a ideia para `cancelAppointment` e para `updateAppointment` quando `status` é passado.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t needsReview`
Expected: FAIL — campo continua true.

**Step 3: Write minimal implementation**

- Em `cancelAppointment` (linha ~197): `data: { status: "CANCELADO", needsReview: false, reviewReason: null }`.
- Em `markRealized` (linha ~203): adicione `needsReview: false, reviewReason: null` ao `data`.
- Em `updateAppointment` (linha ~165): quando `input.status !== undefined`, também setar `data.needsReview = false; data.reviewReason = null;` (a equipe decidiu o status manualmente).

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t needsReview`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/appointment.service.ts src/server/services/appointment.service.test.ts
git commit -m "fix(agenda): ação manual no card zera needsReview (badge baixa)"
```

---

## Task 6: Injetar a interpretação no fluxo de inbound

**Files:**
- Modify: `src/server/services/conversation.service.ts` (novo passo em `respondToLead`, após o bloco `PROPOSED` ~linha 502)
- Modify: importar `interpretAppointmentReply`, `decideApptTransition`, `applyApptTransition`

**Contexto:** roda ANTES da qualificação. Se consumir a mensagem (intent ≠ unclear), NÃO segue para atendimento/qualificação nesse turno — a "conversa" foi sobre o agendamento. Se `unclear`, cai no fluxo normal (a mensagem podia ser uma dúvida real).

**Step 1: Escreva a função de passo, isolada**

No mesmo arquivo, adicione uma helper privada:

```ts
import { interpretAppointmentReply } from "@/server/ai/conversation.agent";
import { decideApptTransition, applyApptTransition } from "./appointment.service";
import { formatSlot } from "@/lib/utils";
import { env } from "@/lib/env";

/**
 * Se o lead tem UM agendamento futuro já lembrado, interpreta a última mensagem
 * como confirmação/recusa/remarcação e aplica a transição. Retorna true se a
 * mensagem foi "consumida" pelo agendamento (o turno encerra sem atendimento).
 * Vários agendamentos futuros elegíveis → não adivinha: só sinaliza revisão.
 */
async function tryHandleAppointmentReply(
  lead: { id: string; userId: string },
  ai: AiClient,
  lastInbound: string,
): Promise<boolean> {
  const now = new Date();
  const appts = await prisma.appointment.findMany({
    where: {
      lead: { userId: lead.userId },
      leadId: lead.id,
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      scheduledAt: { gt: now },
      OR: [{ remindedDayBeforeAt: { not: null } }, { remindedHourBeforeAt: { not: null } }],
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, scheduledAt: true, serviceName: true },
  });
  if (appts.length === 0) return false;

  const reply = await interpretAppointmentReply({
    ai,
    serviceName: appts[0].serviceName,
    whenLabel: formatSlot(appts[0].scheduledAt.toISOString(), env.SCHEDULING_TIMEZONE),
    leadMessage: lastInbound,
  });
  const t = decideApptTransition(reply);
  if (!t) return false; // unclear → deixa seguir p/ atendimento normal

  // Mais de um agendamento futuro elegível: não dá p/ saber qual → só sinaliza,
  // sem mudar status de nenhum. Marca todos p/ revisão manual.
  if (appts.length > 1) {
    for (const a of appts) {
      await applyApptTransition(lead.userId, a.id, {
        status: null,
        needsReview: true,
        reviewReason: "Cliente respondeu ao lembrete (vários agendamentos) — conferir qual",
      });
    }
    return true;
  }

  await applyApptTransition(lead.userId, appts[0].id, t);
  return true;
}
```

> `AiClient` já é o tipo do client retornado por `getAiClient`. Se o client ainda não foi criado neste ponto do fluxo, crie-o com `getAiClient(lead.userId, effectiveModel)` como já é feito — ver Step 2 para posicionamento.

**Step 2: Chame o passo em `respondToLead`**

Logo após o bloco `if (status === "REUNIAO_AGENDADA") return;` (linha ~506) e ANTES de carregar `company`/qualificação, insira:

```ts
  // 3b. Resposta a um lembrete de agendamento (confirma/recusa/remarca).
  //     Precede a qualificação: se o cliente respondeu sobre o agendamento, o
  //     turno é sobre isso — não roda atendimento por cima.
  {
    const lastInbound = await prisma.message.findFirst({
      where: { leadId: lead.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (lastInbound?.content) {
      const model = await resolveAiModelForUser(lead.userId, null);
      if (!(await ensureAiCredit(lead, model))) return; // cota → fila humana
      const ai = await getAiClient(lead.userId, model ?? undefined);
      if (await tryHandleAppointmentReply(lead, ai, lastInbound.content)) return;
    }
  }
```

> Isso duplica levemente a criação do client, mas mantém o passo autocontido e barato (só roda quando há agendamento lembrado — a query é indexada por `[status, scheduledAt]`). Se preferir, refatore para reaproveitar o `ai` mais abaixo, mas cuidado com a ordem de `ensureAiCredit`.

**Step 3: Verifique a compilação e a suíte**

Run: `npx tsc --noEmit && npx vitest run src/server/services/conversation`
Expected: compila; testes de conversa continuam verdes.

**Step 4: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(agenda): inbound interpreta resposta ao lembrete e aplica status"
```

---

## Task 7: Endpoint de contagem + badge na Sidebar

**Files:**
- Create: `src/app/api/appointments/review-count/route.ts`
- Modify: `src/components/app/Sidebar.tsx`

**Step 1: Crie o endpoint de contagem**

`src/app/api/appointments/review-count/route.ts` — espelhe o padrão de `/api/inbox` (auth por sessão + `accountId`). Retorna `{ count }`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session"; // usar o helper de auth já existente no projeto

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  const count = await prisma.appointment.count({
    where: { needsReview: true, lead: { userId: user.accountId } },
  });
  return NextResponse.json({ count });
}
```

> ⚠️ Confirme o helper de auth real olhando outro route em `src/app/api/appointments/route.ts` — use exatamente o mesmo mecanismo de sessão/escopo de conta que ele usa (não invente `requireUser` se o projeto usa outro nome).

**Step 2: Adicione o badge "agenda" na Sidebar**

Em `src/components/app/Sidebar.tsx`:

1. Tipo (linha 17): `badge?: "inbox" | "financeiro" | "consultores" | "agenda";`
2. Estado (junto da linha 34): `const [agendaBadge, setAgendaBadge] = useState(0);`
3. Novo `useEffect` de polling (espelhe o de inbox, linha 39-58, 15s):

```tsx
useEffect(() => {
  let active = true;
  async function load() {
    try {
      const res = await fetch("/api/appointments/review-count", { cache: "no-store" });
      const data = await res.json();
      if (active && typeof data.count === "number") setAgendaBadge(data.count);
    } catch {}
  }
  load();
  const t = setInterval(load, 15000);
  return () => { active = false; clearInterval(t); };
}, []);
```

4. No item Agenda (linha 117): `{ href: "/agenda", label: "Agenda", icon: CalendarClock, badge: "agenda" },`
5. No cálculo de `badgeCount` (linha 204-211), adicione o ramo: `: badge === "agenda" ? agendaBadge`.

**Step 3: Verifique visualmente**

Run: `npm run dev` (pare depois), abra `/agenda` com um agendamento marcado `needsReview=true` no banco → badge verde aparece no item Agenda.

**Step 4: Commit**

```bash
git add src/app/api/appointments/review-count src/components/app/Sidebar.tsx
git commit -m "feat(agenda): badge de revisão no menu Agenda (contador needsReview)"
```

---

## Task 8: Destaque visual do card + filtro na AgendaView (revisão)

**Files:**
- Modify: `src/components/AgendaView.tsx` e/ou `src/components/clientes/AppointmentSection.tsx`
- Modify: `src/app/api/appointments/route.ts` + `src/server/services/appointment.service.ts` (`listAppointments` já aceita filtros; adicionar `needsReview?` ao `ListAppointmentsParams` e à seleção de campos)

**Objetivo:** o badge leva à Agenda; lá o card que precisa de revisão precisa se destacar (ex.: borda âmbar + texto do `reviewReason`) e idealmente um filtro "Aguardando revisão".

**Step 1:** exponha `needsReview`/`reviewReason` no retorno de `listAppointments` (adicionar aos `select`/`include`).

**Step 2:** na UI, quando `appt.needsReview`, renderize um selo (ex.: "⚠ {reviewReason}") e uma borda destacada usando os tokens do tema ([[design-tokens-dark-theme]] — nada de hex fixo).

**Step 3:** filtro opcional "Aguardando revisão" que chama `GET /api/appointments?needsReview=true`.

**Step 4:** teste manual — badge → clica → Agenda mostra os cards destacados. Confirmar/Cancelar zera o selo e baixa o badge (Task 5).

**Step 5: Commit**

```bash
git add src/components/AgendaView.tsx src/components/clientes/AppointmentSection.tsx src/app/api/appointments/route.ts src/server/services/appointment.service.ts
git commit -m "feat(agenda): destaca e filtra agendamentos aguardando revisão"
```

---

## Task 9: SQL manual idempotente para PROD

**Files:**
- Create: `prisma/manual/2026-07-05-appointment-needs-review.sql`

**Contexto:** [[prod-schema-drift-destravar]] — PROD nunca fez cutover pra `migrate deploy`; toda coluna nova precisa de SQL manual idempotente aplicado no Supabase, senão qualquer query que a referencie dá 500.

**Step 1:** escreva o SQL a partir do `migration.sql` do Task 3, tornando-o idempotente:

```sql
-- Confirmação automática de agendamento: campos de revisão.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_needsReview_idx" ON "Appointment"("needsReview");
```

**Step 2:** rodar no Supabase (o env do DB é Sensitive e não alcança daqui — aplicar pelo painel/SQL editor).

**Step 3:** validar em PROD: abrir `/agenda`, confirmar que carrega sem 500 e que o endpoint `/api/appointments/review-count` responde `{ count: 0 }`.

**Step 4: Commit**

```bash
git add prisma/manual/2026-07-05-appointment-needs-review.sql
git commit -m "chore(agenda): SQL manual idempotente needsReview p/ PROD"
```

---

## Verificação de ponta a ponta (antes de fechar)

1. Seed: um lead com um `Appointment` futuro, `remindedDayBeforeAt` setado.
2. Simule um inbound "pode confirmar" → `respondToLead` → status vira `CONFIRMADO`, `needsReview=true`, `reviewReason="Cliente confirmou pelo WhatsApp"`.
3. Badge da Agenda mostra `1`.
4. Inbound "não vou poder" em outro appt → `CANCELADO` + revisão.
5. Inbound "qual o valor?" (unclear) → nenhum appt muda; a IA responde normalmente (atendimento).
6. Equipe clica Confirmar/Realizado no card → `needsReview=false` → badge baixa.
7. `npx vitest run` inteiro verde + `npx tsc --noEmit` limpo.

---

## Riscos e notas

- **Falso positivo de interpretação:** mitigado por (a) só rodar com lembrete já enviado, (b) só aplicar status quando `confident=true`, (c) não adivinhar com múltiplos agendamentos. `unclear` sempre devolve o turno pro atendimento.
- **Custo de token:** +1 chamada `cheap` por inbound SÓ quando existe agendamento futuro lembrado (query barata e indexada filtra o resto). Alinhado com [[ai-context-and-media-policy]] (o custo é token, e essa chamada é mínima — `maxTokens: 256`).
- **Handoff humano:** o passo roda depois do check de `aiPaused` — operador no controle continua tendo silêncio da IA (a interpretação não dispara). ✔
- **Texto configurável do lembrete:** fora de escopo deste plano (segue fixo/neutro). É trabalho independente.
```
