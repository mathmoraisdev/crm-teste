# Cota de IA — Teto na chave da plataforma (BYOK = ilimitado) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar a cada plano uma cota mensal de atendimentos de IA na **chave da plataforma**; quando o cliente estoura a cota, a IA para de gerar resposta naquele lead, manda uma mensagem fixa e joga o lead pra fila humana. Quem usa **BYOK** (chave própria) é **ilimitado** e nunca conta.

**Architecture:** Hoje `resolveProviderForUser(userId)` já retorna `source: "user" | "platform"` ([resolve.ts:8](../../src/server/ai/resolve.ts#L8)) — essa é a peça-chave: só contamos/bloqueamos quando `source === "platform"`. Adicionamos (1) a dimensão `aiMonthlyQuota` em `PLAN_LIMITS`, (2) um contador mensal cifrado-por-virada-de-mês no `User` dono (`aiCreditMonth` + `aiCreditUsed`, reset em tempo real sem cron — mesma filosofia do `accessUntil`), (3) `consumeAiCredit(userId)` ao lado do `assertFeature` existente, e (4) um gate no topo das duas vias de IA do `respondToLead`. A unidade cobrada é **1 inbound que aciona a IA = 1 crédito** (não tokens), simples de explicar ao cliente.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + PostgreSQL, Zod, Vitest. Sem libs novas.

---

## Decisões já tomadas (não reabrir)

- **Unidade de cobrança:** 1 atendimento de IA = 1 inbound que aciona a IA (não tokens). Um inbound pode disparar qualificação + próxima pergunta + slot, mas conta **1** crédito.
- **BYOK = ilimitado:** `source === "user"` curto-circuita o gate na primeira linha; nada é contado nem persistido.
- **Tenant = dono.** O contador mora no `User` dono (o `lead.userId` já é o dono, igual ao `assertFeature`). Operadores não têm contador próprio.
- **Reset mensal sem cron:** comparamos `aiCreditMonth` com o mês atual na hora de consumir; se mudou, zera. Igual ao `accessUntil` que "expira em tempo real".
- **Grandfather/admin sem teto:** `plan == null` ou admin da plataforma → ilimitado (espelha `assertFeature`).
- **Soft gate (não silêncio):** ao estourar, manda uma mensagem fixa ao lead, marca o lead como `FILA` + `aiPaused` (humano assume). O dono vê banner pra upgrade/BYOK. BYOK é a válvula de escape natural.
- **Cotas iniciais (placeholder, recalibrar com custo real):** INICIAL 300 / PROFISSIONAL 1500 / ESCALA 5000 por mês.

---

## Task 0: Dimensão de cota em PLAN_LIMITS

**Files:**
- Modify: `src/lib/plans.ts`
- Modify: `src/lib/plans.test.ts`

**Step 1: Escrever o teste que falha**

Em `src/lib/plans.test.ts`, dentro do `describe("PLAN_LIMITS", ...)`, adicione um novo `it`:
```ts
  it("define a cota mensal de IA por plano", () => {
    expect(PLAN_LIMITS.INICIAL.aiMonthlyQuota).toBe(300);
    expect(PLAN_LIMITS.PROFISSIONAL.aiMonthlyQuota).toBe(1500);
    expect(PLAN_LIMITS.ESCALA.aiMonthlyQuota).toBe(5000);
  });
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: FAIL (`aiMonthlyQuota` é `undefined`).

**Step 3: Implementar**

Em `src/lib/plans.ts`, adicione o campo à interface e aos três planos:
```ts
export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;   // inclui o admin da conta
  qualify: boolean;   // pode ligar qualifyEnabled por número
  schedule: boolean;  // pode ligar scheduleEnabled por número
  campaigns: boolean; // pode criar/rodar campanha
  aiMonthlyQuota: number; // teto de atendimentos de IA/mês na chave da PLATAFORMA (BYOK ignora)
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 12700, maxNumbers: 1, maxSeats: 2,  qualify: false, schedule: false, campaigns: false, aiMonthlyQuota: 300  },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 1500 },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 5000 },
};
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(cota-ia): aiMonthlyQuota por plano"
```

---

## Task 1: Schema Prisma — contador mensal no User

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Adicionar os campos**

Em `model User` ([schema.prisma:52](../../prisma/schema.prisma#L52)), logo após o bloco BYOK (`aiKeyVerifiedAt`), adicione:
```prisma
  // Cota de IA na chave da PLATAFORMA (BYOK ignora). Reset por virada de mês,
  // em tempo real (sem cron): se aiCreditMonth != mês atual, o contador zera.
  aiCreditMonth String? // "YYYY-MM" — mês de referência do contador
  aiCreditUsed  Int     @default(0) // atendimentos de IA consumidos no mês corrente
```

**Step 2: Aplicar ao banco (dev)**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." + regeneração do client.

> **Produção:** este repo faz `db push` no deploy (ver memory de deploy). Não criar migration manual aqui — seguir o fluxo de deploy existente.

**Step 3: Verificar o client tipado**

Run: `npx prisma generate`
Expected: sucesso; `aiCreditMonth`/`aiCreditUsed` disponíveis em `User`.

**Step 4: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat(cota-ia): contador mensal aiCreditMonth/aiCreditUsed no User"
```

---

## Task 2: `monthKey` + `consumeAiCredit` (núcleo do teto)

**Files:**
- Modify: `src/server/services/entitlements.ts`
- Modify: `src/server/services/entitlements.test.ts`

**Step 1: Escrever os testes que falham**

Em `src/server/services/entitlements.test.ts`, no topo, estenda o mock do prisma para incluir `update` e mocke o módulo de resolução de provider (para controlar `source` sem tocar em cripto/banco):
```ts
vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/server/ai/resolve", () => ({
  resolveProviderForUser: vi.fn(),
}));
```

Adicione um novo bloco `describe` ao final do arquivo:
```ts
describe("monthKey", () => {
  it("formata YYYY-MM em UTC", async () => {
    const { monthKey } = await import("./entitlements");
    expect(monthKey(new Date("2026-06-28T23:00:00Z"))).toBe("2026-06");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("consumeAiCredit", () => {
  beforeEach(() => vi.clearAllMocks());

  const NOW = new Date("2026-06-15T12:00:00Z"); // mês "2026-06"

  it("BYOK (source=user) → ilimitado, não conta nem persiste", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { prisma } = await import("@/server/db/client");
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "user" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("plataforma, dentro da cota → permite e incrementa", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 10,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 11, quota: 300 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 11 },
    });
  });

  it("plataforma, cota estourada → bloqueia e NÃO incrementa", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 300,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: false, used: 300, quota: 300 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("plataforma, mês virou → zera e conta o 1º do mês novo", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-05", aiCreditUsed: 300,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 1, quota: 300 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 1 },
    });
  });

  it("plano null (grandfather) → ilimitado, não conta", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: null });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 0, quota: Infinity });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("admin da plataforma → ilimitado", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "admin@exemplo.com", plan: "INICIAL" });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("admin-1", NOW);
    expect(r.allowed).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: FAIL (`monthKey`/`consumeAiCredit` não existem).

**Step 3: Implementar**

Em `src/server/services/entitlements.ts`, adicione o import do resolve no topo e as funções ao final:
```ts
import { resolveProviderForUser } from "@/server/ai/resolve";
```
```ts
/** Chave de mês "YYYY-MM" em UTC — usada pra resetar a cota na virada. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Resultado de consumir 1 crédito de atendimento de IA. */
export type AiQuotaResult =
  | { allowed: true; source: "user" }                              // BYOK: ilimitado
  | { allowed: true; source: "platform"; used: number; quota: number }
  | { allowed: false; used: number; quota: number };               // teto atingido

/**
 * Consome 1 crédito de IA para o tenant (`userId` = dono). Regras:
 *  - BYOK (chave própria do usuário) → ilimitado, não conta nada.
 *  - plano null (grandfather) ou admin da plataforma → ilimitado.
 *  - senão → conta contra PLAN_LIMITS[plan].aiMonthlyQuota, resetando na virada
 *    de mês. Retorna { allowed:false } se já estourou (sem incrementar).
 *
 * `now` é injetável só p/ teste determinístico (default = agora).
 */
export async function consumeAiCredit(userId: string, now: Date = new Date()): Promise<AiQuotaResult> {
  // BYOK curto-circuita: quem traz a própria chave paga os próprios créditos.
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return { allowed: true, source: "user" };

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, aiCreditMonth: true, aiCreditUsed: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) {
    return { allowed: true, source: "platform", used: 0, quota: Infinity }; // grandfather/admin
  }

  const month = monthKey(now);
  const quota = PLAN_LIMITS[owner.plan].aiMonthlyQuota;
  // Virada de mês zera o contador (reset em tempo real, sem cron).
  const used = owner.aiCreditMonth === month ? owner.aiCreditUsed : 0;

  if (used >= quota) return { allowed: false, used, quota };

  const next = used + 1;
  await prisma.user.update({
    where: { id: userId },
    data: { aiCreditMonth: month, aiCreditUsed: next },
  });
  return { allowed: true, source: "platform", used: next, quota };
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: PASS (todos, incluindo os 5 testes antigos de `assertFeature`).

> Atenção: os testes antigos mockam `prisma` só com `findUnique`. O Step 1 já trocou o mock pra incluir `update` — confirme que os testes de `assertFeature` continuam verdes.

**Step 5: Commit**
```bash
git add src/server/services/entitlements.ts src/server/services/entitlements.test.ts
git commit -m "feat(cota-ia): consumeAiCredit + monthKey (BYOK ilimitado, reset mensal)"
```

---

## Task 3: Status de uso para a UI (`getAiUsageStatus`)

**Files:**
- Modify: `src/server/services/entitlements.ts`
- Modify: `src/server/services/entitlements.test.ts`

**Step 1: Teste que falha**

Adicione ao `entitlements.test.ts`:
```ts
describe("getAiUsageStatus", () => {
  beforeEach(() => vi.clearAllMocks());
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("BYOK → ilimitado", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toEqual({ unlimited: true, reason: "byok" });
  });

  it("plataforma com plano → used/quota do mês corrente", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 420,
    });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toEqual({
      unlimited: false, used: 420, quota: 1500, month: "2026-06",
    });
  });

  it("plataforma, mês virou → used=0 (não vaza o mês anterior)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-05", aiCreditUsed: 1500,
    });
    const { getAiUsageStatus } = await import("./entitlements");
    expect(await getAiUsageStatus("dono-1", NOW)).toMatchObject({ used: 0, quota: 1500 });
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: FAIL (`getAiUsageStatus` não existe).

**Step 3: Implementar**

Adicione em `entitlements.ts`:
```ts
export type AiUsageStatus =
  | { unlimited: true; reason: "byok" | "grandfather" | "admin" }
  | { unlimited: false; used: number; quota: number; month: string };

/** Leitura (sem mutação) do consumo de IA do tenant — pra exibir na UI. */
export async function getAiUsageStatus(userId: string, now: Date = new Date()): Promise<AiUsageStatus> {
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return { unlimited: true, reason: "byok" };

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, aiCreditMonth: true, aiCreditUsed: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (isAdminEmail(owner.email)) return { unlimited: true, reason: "admin" };
  if (!owner.plan) return { unlimited: true, reason: "grandfather" };

  const month = monthKey(now);
  const used = owner.aiCreditMonth === month ? owner.aiCreditUsed : 0;
  return { unlimited: false, used, quota: PLAN_LIMITS[owner.plan].aiMonthlyQuota, month };
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/server/services/entitlements.ts src/server/services/entitlements.test.ts
git commit -m "feat(cota-ia): getAiUsageStatus p/ exibir consumo na UI"
```

---

## Task 4: Cravar o gate no `respondToLead` (chokepoint)

**Files:**
- Modify: `src/server/services/conversation.service.ts`

> As duas vias de IA do inbound são **mutuamente exclusivas** (a via de reunião `PROPOSED` dá `return` antes da via principal), então 1 inbound = no máximo 1 consumo. O `REUNIAO_AGENDADA` e o silêncio por `aiPaused` dão `return` **antes** do gate → não gastam crédito.

**Step 1: Adicionar a mensagem fixa e o helper de gate**

No topo de `conversation.service.ts` (junto às constantes), adicione:
```ts
// Mensagem enviada ao lead quando a cota de IA do mês (chave da plataforma) acaba.
// MVP: fixa. Follow-up: tornar configurável por número/conta.
const AI_QUOTA_EXCEEDED_MESSAGE =
  "Recebi sua mensagem! 🙌 Em instantes um de nossos atendentes vai continuar por aqui.";
```

E importe o consumidor de crédito (junto do import de `getAiClient`):
```ts
import { consumeAiCredit } from "@/server/services/entitlements";
```

Adicione um helper privado perto de `aiStillActive`:
```ts
/**
 * Garante 1 crédito de IA antes de gerar resposta na chave da plataforma.
 * BYOK/grandfather/admin sempre passam. Se a cota estourou: manda a mensagem
 * fixa, joga o lead pra fila humana (aiPaused) e devolve false — o chamador
 * deve abortar a geração. `lead` precisa de { id, userId } no mínimo.
 */
async function ensureAiCredit(lead: { id: string; userId: string }): Promise<boolean> {
  const credit = await consumeAiCredit(lead.userId);
  if (credit.allowed) return true;
  // Teto atingido → handoff suave: humano assume, sem deixar o lead no vácuo.
  await sendWhatsAppMessage(lead, AI_QUOTA_EXCEEDED_MESSAGE);
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      aiPaused: true,
      aiPausedAt: new Date(),
      attendanceStatus: "FILA",
      ...(/* só inicia o SLA se ainda não estava na fila */ {} as Record<string, never>),
    },
  });
  return false;
}
```
> Confirme a assinatura de `sendWhatsAppMessage` (usada na linha ~440 como `sendWhatsAppMessage(lead, texto)`) e os campos válidos de `attendanceStatus` no schema antes de editar. Se `queuedAt` precisar ser setado p/ o SLA do inbox (ver `setHandoff` na linha ~459), replique a mesma lógica condicional `...(lead.queuedAt ? {} : { queuedAt: new Date() })`.

**Step 2: Gate na via de reunião (PROPOSED)**

Em `respondToLead`, dentro do bloco `if (meeting?.status === "PROPOSED")` (linha ~353), **antes** de `interpretAndBook`:
```ts
  if (meeting?.status === "PROPOSED") {
    if (!(await aiStillActive(lead.id))) return; // operador assumiu durante o debounce
    if (!(await ensureAiCredit(lead))) return;   // cota de IA estourada → fila humana
    const lastInbound = await prisma.message.findFirst({ /* ...igual... */ });
    if (lastInbound) await interpretAndBook(lead.id, lastInbound.content);
    return;
  }
```

**Step 3: Gate na via principal (qualificação/atendimento)**

Logo **antes** de `const ai = await getAiClient(lead.userId, ...)` (linha ~392):
```ts
  if (!(await ensureAiCredit(lead))) return; // cota de IA estourada → fila humana
  const ai = await getAiClient(lead.userId, company?.aiModel ?? undefined);
```

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros. (Ajuste o objeto do `update` se o type do `attendanceStatus`/`queuedAt` reclamar — use os mesmos campos do `setHandoff`.)

**Step 5: Rodar a suíte (garante que nada quebrou no fluxo de inbound)**

Run: `npx vitest run`
Expected: tudo verde.

**Step 6: Commit**
```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(cota-ia): gate de cota no respondToLead (handoff suave ao estourar)"
```

---

## Task 5: UI do cliente — medidor de uso em /configuracoes

**Files:**
- Modify: `src/app/(app)/configuracoes/page.tsx`
- Modify: `src/components/app/AccountSettings.tsx`

> Reusa o padrão do card de chave de API (BYOK) que já vive nessa tela. Confirme como o `userId` do dono é obtido no server component (o BYOK usa `getCurrentUserId()` de `@/lib/session`).

**Step 1: Buscar o status no server component**

Em `configuracoes/page.tsx`, junto da busca do status BYOK (`getAiCredentialStatus`), adicione:
```ts
import { getAiUsageStatus } from "@/server/services/entitlements";
// ...após obter userId:
const aiUsage = await getAiUsageStatus(userId);
// ...passar ao componente:
<AccountSettings account={{ /* ... */ }} aiKey={aiKey} aiUsage={aiUsage} />
```

**Step 2: Renderizar o medidor**

Em `AccountSettings.tsx`:
- Estenda as props com:
```ts
aiUsage:
  | { unlimited: true; reason: "byok" | "grandfather" | "admin" }
  | { unlimited: false; used: number; quota: number; month: string };
```
- Dentro do card "Chave de API de IA" (ou um card novo logo abaixo), renderize:
```tsx
<div className="px-5 py-3 text-sm text-slate-600">
  {props.aiUsage.unlimited ? (
    <span>Atendimentos de IA: <strong>Ilimitado</strong>{props.aiUsage.reason === "byok" ? " (sua chave)" : ""}</span>
  ) : (
    <>
      <span>
        Atendimentos de IA: <strong>{props.aiUsage.used} / {props.aiUsage.quota}</strong> este mês
      </span>
      {props.aiUsage.used >= props.aiUsage.quota && (
        <p className="mt-1 text-[#C0392B]">
          Cota esgotada. Faça upgrade de plano ou cadastre sua própria chave de IA acima para liberar atendimentos ilimitados.
        </p>
      )}
    </>
  )}
</div>
```
> Ajuste classes/wrappers ao padrão real do repo (`Card`, cores). Não invente componentes novos.

**Step 3: Rodar a app e validar**

Run: `npm run dev`
Verificações em `/configuracoes`:
1. Conta na plataforma com plano → mostra `X / N este mês`.
2. Com BYOK ativo → mostra `Ilimitado (sua chave)`.
3. Forçando `aiCreditUsed = quota` no banco → aparece o aviso vermelho de upgrade.

**Step 4: Type-check + commit**
```bash
npx tsc --noEmit
git add "src/app/(app)/configuracoes/page.tsx" src/components/app/AccountSettings.tsx
git commit -m "feat(cota-ia): medidor de consumo de IA em Configuracoes"
```

---

## Task 6: UI do admin — consumo por conta em /financeiro

**Files:**
- Modify: `src/app/(app)/financeiro/page.tsx`

> Objetivo: o admin enxerga quem está perto/estourando o teto (candidatos a upgrade). Escopo mínimo — uma coluna/linha por conta.

**Step 1: Incluir o consumo na listagem**

Onde a página já lista as contas com `plan`, inclua `aiCreditMonth`/`aiCreditUsed` no `select` e exiba, por conta:
```tsx
{owner.plan
  ? `IA: ${owner.aiCreditMonth === currentMonth ? owner.aiCreditUsed : 0} / ${PLAN_LIMITS[owner.plan].aiMonthlyQuota}`
  : "IA: ilimitado"}
```
onde `currentMonth = monthKey()` (importe de `@/server/services/entitlements`). Para contas com BYOK ativo (`aiProvider != null`), mostre `IA: BYOK`.

**Step 2: Validar visualmente**

Run: `npm run dev` → abrir `/financeiro` como admin. Conferir que cada conta mostra o consumo do mês, BYOK e ilimitado corretamente.

**Step 3: Type-check + commit**
```bash
npx tsc --noEmit
git add "src/app/(app)/financeiro/page.tsx"
git commit -m "feat(cota-ia): consumo de IA por conta no painel admin"
```

---

## Task 7: Verificação end-to-end

**Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde (evals de IA pulados sem `RUN_AI_EVALS=1`).

**Step 2: Build**

Run: `npm run build`
Expected: build conclui sem erro.

**Step 3: Teste manual do teto (caminho feliz e bloqueio)**

1. Conta plataforma, plano INICIAL, `aiCreditUsed = 299`: dispara 1 inbound → IA responde, `aiCreditUsed` vira 300.
2. Próximo inbound (300/300): IA **não** responde via modelo; lead recebe a mensagem fixa, vai pra `FILA` com `aiPaused = true`; `/configuracoes` mostra aviso vermelho.
3. Cadastra chave própria (BYOK) → reabre o lead (resume) e dispara inbound → IA responde de novo (ilimitado), `aiCreditUsed` **não** sobe.
4. Vira o mês (ajustar `aiCreditMonth` no banco p/ mês anterior) → consumo volta a `0 / N`.

**Step 4: Commit final (se houver ajustes)**
```bash
git add -A
git commit -m "test(cota-ia): verificacao e2e do teto de IA"
```

---

## Notas / follow-ups (fora do MVP)

- **Concorrência exata:** dois inbounds simultâneos do mesmo tenant podem ler o mesmo `used` e ambos passarem (erro de ±poucos créditos). Se precisar de exatidão, trocar o `update` por incremento atômico condicional: `prisma.user.updateMany({ where: { id, OR: [{ aiCreditMonth: { not: month } }, { aiCreditUsed: { lt: quota } }] }, data: { ... } })` e usar a contagem afetada como autorização. Reset de mês fica mais chato (precisa de 2 caminhos) — por isso ficou como follow-up.
- **Anti-spam da mensagem fixa:** com `aiPaused = true`, o `respondToLead` já dá `return` no topo nos próximos inbounds → não reenvia. Mas se o operador resumir com a cota ainda estourada, o lead leva a mensagem fixa de novo. Considerar um flag "já avisado neste mês".
- **Mensagem fixa configurável:** hoje constante. Tornar campo por número/conta (igual `customInstructions`).
- **Alerta proativo:** avisar o dono em 80%/100% da cota (e-mail/banner) antes de bloquear.
- **Cobrança de excedente:** alternativa ao bloqueio — deixar passar e cobrar por atendimento extra (exige integração de billing).
- **Calibrar as cotas:** 300/1500/5000 são placeholders — fechar com o custo real por atendimento (tokens médios × preço do modelo) e a margem desejada.
- **Pricing page:** refletir a cota e o "ilimitado com sua chave" no `PricingPlans.tsx` / landing.
