# Modelos por plano + crédito ponderado por custo — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Diferenciar o acesso a modelos de IA por plano (trial/INICIAL só modelo econômico; planos pagos liberam o modelo avançado) e fazer o avançado consumir **mais créditos por atendimento**, de forma que o custo da chave da plataforma fique sempre limitado pelo pool pré-pago da mensalidade. BYOK continua ilimitado e com qualquer modelo.

**Architecture:** Estende a cota de IA já existente ([entitlements.ts](../../src/server/services/entitlements.ts)). Três peças novas: (1) cada modelo do catálogo ganha um **tier** (`cheap`/`strong`) e um **peso de crédito** em [ai-models.ts](../../src/lib/ai-models.ts) (módulo client+server, sem SDK); (2) `PLAN_LIMITS` ganha `allowStrongModel` — INICIAL não, PRO/ESCALA sim; (3) `consumeAiCredit` passa a cobrar **peso(modelo) créditos** em vez de 1, e há um **clamp do modelo por plano** em 3 camadas (UI filtra, PATCH rejeita, runtime no `respondToLead` ignora override não-permitido). Conta nova nasce **INICIAL** (fecha o buraco de "trial ilimitado"); `plan = null` continua sendo grandfather ilimitado, reservado a contas que o admin marca de propósito.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + PostgreSQL, Zod, Vitest. Sem libs novas.

---

## Contexto do código (já verificado — não re-descobrir)

- **Tiers das chamadas:** `conversation.agent.ts` (atendimento + próxima pergunta) usa `tier: "cheap"`; `qualification.agent.ts` usa `tier: "strong"`. Em [provider.ts:55](../../src/server/ai/provider.ts#L55), `pick = (tier, callModel) => callModel || clientModel || models[tier]` — ou seja, um `aiModel` por número **força TODAS as chamadas** para aquele modelo (ignora o tier). Sem `aiModel` (null = "Padrão da conta"), cada chamada usa o modelo do seu tier (`env.AI_MODEL_CHEAP`/`AI_MODEL_STRONG`).
- **Catálogo de modelos:** [ai-models.ts](../../src/lib/ai-models.ts) — `AI_MODELS_BY_PROVIDER` (value/label por provider) + `ALL_AI_MODEL_VALUES` (validação do PATCH). É importado pela UI ([WhatsAppNumbersPanel.tsx](../../src/components/WhatsAppNumbersPanel.tsx)) e pelo backend.
- **Gate atual:** `respondToLead` chama `ensureAiCredit(lead)` → `consumeAiCredit(userId)` (cobra 1) e depois `getAiClient(lead.userId, company?.aiModel ?? undefined)`. O gate já só roda quando `mode.qualify || mode.reply` (fix recente).
- **Cota/entitlements:** `consumeAiCredit`/`getAiUsageStatus` tratam `plan = null` e admin como ilimitados; `monthKey` reseta na virada de mês.
- **Conta nova:** [user.service.ts:43](../../src/server/services/user.service.ts#L43) cria o User **sem `plan`** (null) → hoje vira grandfather ilimitado. Nasce suspensa (`accessUntil` por `TRIAL_DAYS`).
- **PATCH do número:** validação do `aiModel` vive em `numbers.service.ts`/[api/numbers/[id]/route.ts](../../src/app/api/numbers/[id]/route.ts) usando `ALL_AI_MODEL_VALUES`.

---

## Decisões já tomadas (não reabrir)

- **Trial = nasce INICIAL.** Conta nova nasce com `plan = "INICIAL"` (cheap-only, pool pequeno). `plan = null` continua = grandfather ilimitado, mas passa a ser **estado que só o admin atribui** (não nasce assim). Trade-off aceito: o trial experimenta o INICIAL (1 número, sem qualify/schedule/campaigns); contas promissoras o admin sobe pra PRO no /financeiro.
- **Tier por plano:** INICIAL → só `cheap`; PROFISSIONAL/ESCALA → `cheap` + `strong`. BYOK → qualquer modelo, ilimitado.
- **Crédito ponderado:** 1 atendimento consome **peso(modelo do número) créditos**. `cheap` = 1; `strong` = **10** (placeholder, calibrar). Número sem override (`aiModel = null`) = peso 1 (padrão econômico). A cota deixa de ser "atendimentos" e vira **pool de créditos/mês**.
- **Pool = teto de custo.** O custo máximo de API por conta/mês = `pool × custo de 1 crédito (≈ 1 atendimento cheap)`, independente do mix de modelos. O tamanho do pool é a alavanca de margem.
- **Enforcement em 3 camadas:** UI esconde/desabilita o modelo strong para planos sem permissão; o PATCH rejeita gravar strong sem permissão; o `respondToLead` **clampa em runtime** (se o número tem strong mas o plano não permite — ex.: downgrade — ignora o override e usa o padrão econômico).
- **Simplificação consciente:** o peso é função do **modelo escolhido no número**, cobrado 1× por atendimento (mesmo que o atendimento dispare qualify+reply). O caso `aiModel = null` com qualify on usa o `strong` do tier interno só na qualificação — esse custo é absorvido; calibrar `env.AI_MODEL_STRONG` para um modelo médio mantém isso barato. Cobrança exata por chamada fica fora do MVP.

---

## Task 0: Tier + peso de crédito no catálogo de modelos

**Files:**
- Modify: `src/lib/ai-models.ts`
- Create: `src/lib/ai-models.test.ts`

**Step 1: Escrever o teste que falha**

Crie `src/lib/ai-models.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { modelTier, modelCreditWeight, AI_MODELS_BY_PROVIDER } from "./ai-models";

describe("modelTier", () => {
  it("classifica modelos avançados como strong", () => {
    expect(modelTier("gpt-4o")).toBe("strong");
    expect(modelTier("claude-opus-4-8")).toBe("strong");
    expect(modelTier("claude-sonnet-4-6")).toBe("strong");
  });
  it("classifica modelos econômicos como cheap", () => {
    expect(modelTier("gpt-4o-mini")).toBe("cheap");
    expect(modelTier("gpt-4.1-nano")).toBe("cheap");
    expect(modelTier("claude-haiku-4-5")).toBe("cheap");
  });
  it("null/vazio/desconhecido → cheap (padrão econômico seguro)", () => {
    expect(modelTier(null)).toBe("cheap");
    expect(modelTier("")).toBe("cheap");
    expect(modelTier("modelo-que-nao-existe")).toBe("cheap");
  });
});

describe("modelCreditWeight", () => {
  it("strong pesa 10, cheap pesa 1", () => {
    expect(modelCreditWeight("gpt-4o")).toBe(10);
    expect(modelCreditWeight("gpt-4o-mini")).toBe(1);
  });
  it("null/desconhecido → 1", () => {
    expect(modelCreditWeight(null)).toBe(1);
    expect(modelCreditWeight("xyz")).toBe(1);
  });
});

describe("AI_MODELS_BY_PROVIDER", () => {
  it("todo modelo do catálogo tem tier", () => {
    for (const list of Object.values(AI_MODELS_BY_PROVIDER)) {
      for (const m of list) expect(m.tier === "cheap" || m.tier === "strong").toBe(true);
    }
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/ai-models.test.ts`
Expected: FAIL (`modelTier`/`modelCreditWeight` não existem; `m.tier` undefined).

**Step 3: Implementar**

Em `src/lib/ai-models.ts`, adicione `tier` a cada item, o peso por tier e os helpers:
```ts
export type Tier = "cheap" | "strong";

export interface AiModelOption {
  value: string; // ID exato do modelo na API do provider
  label: string; // nome amigável exibido na UI
  tier: Tier;    // cheap = econômico (peso 1); strong = avançado (peso STRONG_CREDIT_WEIGHT)
}

/** Peso de crédito do tier avançado (placeholder — calibrar pelo custo real). */
export const STRONG_CREDIT_WEIGHT = 10;

export const AI_MODELS_BY_PROVIDER: Record<AiProviderName, AiModelOption[]> = {
  OPENAI: [
    { value: "gpt-4o", label: "GPT-4o", tier: "strong" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "cheap" },
    { value: "gpt-4.1", label: "GPT-4.1", tier: "strong" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", tier: "cheap" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", tier: "cheap" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", tier: "strong" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", tier: "cheap" },
  ],
  ANTHROPIC: [
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", tier: "strong" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "strong" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "cheap" },
  ],
};

const TIER_BY_MODEL = new Map<string, Tier>(
  Object.values(AI_MODELS_BY_PROVIDER).flat().map((m) => [m.value, m.tier]),
);

/** Tier de um modelo. null/vazio/desconhecido → "cheap" (default econômico seguro). */
export function modelTier(model: string | null | undefined): Tier {
  return (model && TIER_BY_MODEL.get(model)) || "cheap";
}

/** Peso de crédito consumido por 1 atendimento neste modelo. */
export function modelCreditWeight(model: string | null | undefined): number {
  return modelTier(model) === "strong" ? STRONG_CREDIT_WEIGHT : 1;
}
```
> `ALL_AI_MODEL_VALUES` continua igual (deriva da lista). Não remova.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/ai-models.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/ai-models.ts src/lib/ai-models.test.ts
git commit -m "feat(modelos): tier + peso de credito por modelo no catalogo"
```

---

## Task 1: `allowStrongModel` por plano

**Files:**
- Modify: `src/lib/plans.ts`
- Modify: `src/lib/plans.test.ts`

**Step 1: Teste que falha**

Em `src/lib/plans.test.ts`, dentro do `describe("PLAN_LIMITS", ...)`:
```ts
  it("só PROFISSIONAL e ESCALA liberam o modelo avançado", () => {
    expect(PLAN_LIMITS.INICIAL.allowStrongModel).toBe(false);
    expect(PLAN_LIMITS.PROFISSIONAL.allowStrongModel).toBe(true);
    expect(PLAN_LIMITS.ESCALA.allowStrongModel).toBe(true);
  });
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: FAIL (`allowStrongModel` undefined).

**Step 3: Implementar**

Em `src/lib/plans.ts`, adicione o campo à interface e aos três planos:
```ts
export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;
  qualify: boolean;
  schedule: boolean;
  campaigns: boolean;
  aiMonthlyQuota: number;     // pool de créditos de IA/mês na chave da PLATAFORMA
  allowStrongModel: boolean;  // pode usar modelo avançado (strong) na chave da plataforma
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 12700, maxNumbers: 1, maxSeats: 2,  qualify: false, schedule: false, campaigns: false, aiMonthlyQuota: 300,  allowStrongModel: false },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 1500, allowStrongModel: true  },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 5000, allowStrongModel: true  },
};
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(modelos): allowStrongModel por plano"
```

---

## Task 2: Conta nova nasce INICIAL (fecha o trial ilimitado)

**Files:**
- Modify: `src/server/services/user.service.ts`
- Modify: `src/server/services/user.service.register.test.ts`
- Modify: `src/server/services/user.service.register.suspended.test.ts` (se assertar plano)

**Step 1: Verificar os testes atuais**

Run: `npx vitest run src/server/services/user.service.register.test.ts src/server/services/user.service.register.suspended.test.ts`
Expected: PASS (estado atual). Leia os dois arquivos: se algum assertar `plan` no User criado, será ajustado no Step 4.

**Step 2: Escrever o teste que falha**

Em `user.service.register.test.ts`, adicione (ou ajuste o mock do `create` para inspecionar o `data`):
```ts
  it("conta nova nasce com plano INICIAL (trial capado, cheap-only)", async () => {
    // ...arrange igual aos outros testes de register...
    await registerUser({ name: "X", email: "novo@x.com", password: "12345678" });
    const createArg = (prisma.user.create as any).mock.calls[0][0];
    expect(createArg.data.plan).toBe("INICIAL");
  });
```
> Ajuste o nome de `registerUser` e o shape do input ao que o arquivo já usa.

**Step 3: Rodar e ver falhar**

Run: `npx vitest run src/server/services/user.service.register.test.ts`
Expected: FAIL (`data.plan` é `undefined`).

**Step 4: Implementar**

Em [user.service.ts:43](../../src/server/services/user.service.ts#L43), adicione `plan` ao `data` do `create`:
```ts
  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      whatsapp: input.whatsapp?.trim() || null,
      passwordHash: hashPassword(input.password),
      billingOverride: "AUTO",
      accessUntil,
      // Nasce no plano de entrada: trial/INICIAL roda só o modelo econômico e tem
      // pool de créditos. plan=null fica reservado a grandfather que o admin marca.
      plan: "INICIAL",
    },
    select: { id: true, sessionEpoch: true },
  });
```

**Step 5: Rodar e ver passar (incluindo os testes de suspensão)**

Run: `npx vitest run src/server/services/user.service.register.test.ts src/server/services/user.service.register.suspended.test.ts`
Expected: PASS. (Se o teste de suspensão assertava algo sobre `plan`, ajuste-o para `INICIAL`.)

**Step 6: Commit**
```bash
git add src/server/services/user.service.ts src/server/services/user.service.register.test.ts src/server/services/user.service.register.suspended.test.ts
git commit -m "feat(modelos): conta nova nasce INICIAL (trial capado e cheap-only)"
```

---

## Task 3: `consumeAiCredit` cobra peso por modelo

**Files:**
- Modify: `src/server/services/entitlements.ts`
- Modify: `src/server/services/entitlements.test.ts`

**Step 1: Escrever os testes que falham**

Em `entitlements.test.ts`, adicione um novo `describe` (reusa os mocks de `prisma`/`resolveProviderForUser` já existentes):
```ts
describe("consumeAiCredit (peso por modelo)", () => {
  beforeEach(() => vi.clearAllMocks());
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("modelo strong cobra STRONG_CREDIT_WEIGHT créditos", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 100,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", "gpt-4o", NOW);
    expect(r).toEqual({ allowed: true, source: "platform", used: 110, quota: 1500 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "dono-1" },
      data: { aiCreditMonth: "2026-06", aiCreditUsed: 110 },
    });
  });

  it("cheap (ou sem modelo) cobra 1", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "INICIAL", aiCreditMonth: "2026-06", aiCreditUsed: 0,
    });
    const { consumeAiCredit } = await import("./entitlements");
    expect(await consumeAiCredit("dono-1", "gpt-4o-mini", NOW)).toMatchObject({ used: 1 });
    expect(await consumeAiCredit("dono-1", null, NOW)).toMatchObject({ used: 1 });
  });

  it("bloqueia se o peso não cabe no que resta (não cobra parcial)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "cli@x.com", plan: "PROFISSIONAL", aiCreditMonth: "2026-06", aiCreditUsed: 1495,
    });
    const { consumeAiCredit } = await import("./entitlements");

    const r = await consumeAiCredit("dono-1", "gpt-4o", NOW); // 1495 + 10 > 1500
    expect(r).toEqual({ allowed: false, used: 1495, quota: 1500 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
```
> Os testes antigos de `consumeAiCredit` (sem 2º arg) continuam válidos: `model` é opcional e default = peso 1.

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: FAIL (assinatura de `consumeAiCredit` ainda é `(userId, now)`).

**Step 3: Implementar**

Em `entitlements.ts`, importe o peso e troque a assinatura/conta:
```ts
import { modelCreditWeight } from "@/lib/ai-models";
```
```ts
export async function consumeAiCredit(
  userId: string,
  model: string | null = null,
  now: Date = new Date(),
): Promise<AiQuotaResult> {
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return { allowed: true, source: "user" };

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, aiCreditMonth: true, aiCreditUsed: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) {
    return { allowed: true, source: "platform", used: 0, quota: Infinity };
  }

  const month = monthKey(now);
  const quota = PLAN_LIMITS[owner.plan].aiMonthlyQuota;
  const used = owner.aiCreditMonth === month ? owner.aiCreditUsed : 0;
  const weight = modelCreditWeight(model); // strong custa mais

  // Bloqueia se o atendimento neste modelo não cabe no que resta (sem cobrar parcial).
  if (used + weight > quota) return { allowed: false, used, quota };

  const next = used + weight;
  await prisma.user.update({
    where: { id: userId },
    data: { aiCreditMonth: month, aiCreditUsed: next },
  });
  return { allowed: true, source: "platform", used: next, quota };
}
```
> **Atenção à mudança de assinatura:** o chamador atual é `ensureAiCredit` em `conversation.service.ts` (Task 4 atualiza). `getAiUsageStatus` **não muda** (leitura por crédito já funciona).

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: PASS (novos + antigos).

**Step 5: Commit**
```bash
git add src/server/services/entitlements.ts src/server/services/entitlements.test.ts
git commit -m "feat(modelos): consumeAiCredit cobra peso por modelo (strong custa mais)"
```

---

## Task 4: Clamp de modelo por plano + peso no gate (`respondToLead`)

**Files:**
- Modify: `src/server/services/entitlements.ts` (helper `resolveAiModelForUser` — ver Step 1)
- Modify: `src/server/services/entitlements.test.ts`
- Modify: `src/server/services/conversation.service.ts`

**Step 1: Teste do resolver de modelo efetivo**

Adicione em `entitlements.test.ts`:
```ts
describe("resolveAiModelForUser (clamp por plano)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plano sem strong → modelo strong vira null (cai no padrão econômico)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o")).toBeNull();
  });

  it("plano com strong → mantém o modelo escolhido", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "ESCALA" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o")).toBe("gpt-4o");
  });

  it("BYOK → mantém qualquer modelo (sem clamp)", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "user" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("modelo cheap passa em qualquer plano", async () => {
    const { resolveProviderForUser } = await import("@/server/ai/resolve");
    (resolveProviderForUser as any).mockResolvedValue({ source: "platform" });
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    const { resolveAiModelForUser } = await import("./entitlements");
    expect(await resolveAiModelForUser("dono-1", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: FAIL (`resolveAiModelForUser` não existe).

**Step 3: Implementar o resolver**

Em `entitlements.ts`:
```ts
import { modelCreditWeight, modelTier } from "@/lib/ai-models";
```
```ts
/**
 * Modelo efetivo a usar para o tenant, respeitando o plano:
 *  - BYOK → o modelo pedido, sem clamp (cliente paga).
 *  - plano sem allowStrongModel + modelo strong → null (cai no padrão econômico do tier).
 *  - senão → o modelo pedido.
 * `requested` = `aiModel` do número (null = padrão da conta).
 */
export async function resolveAiModelForUser(
  userId: string,
  requested: string | null | undefined,
): Promise<string | null> {
  const req = requested ?? null;
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return req; // BYOK: sem clamp

  if (modelTier(req) !== "strong") return req; // cheap/null sempre ok
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) return req; // grandfather/admin: sem clamp
  return PLAN_LIMITS[owner.plan].allowStrongModel ? req : null;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/entitlements.test.ts`
Expected: PASS.

**Step 5: Aplicar no `respondToLead`**

Em `conversation.service.ts`:

1. Importe o resolver junto do `consumeAiCredit`:
```ts
import { consumeAiCredit, resolveAiModelForUser } from "@/server/services/entitlements";
```

2. Mude `ensureAiCredit` para receber o modelo efetivo e cobrar o peso:
```ts
async function ensureAiCredit(
  lead: { id: string; userId: string; phone: string; whatsAppNumberId: string | null; queuedAt: Date | null },
  model: string | null,
): Promise<boolean> {
  const credit = await consumeAiCredit(lead.userId, model);
  if (credit.allowed) return true;
  await sendWhatsAppMessage(lead, AI_QUOTA_EXCEEDED_MESSAGE);
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      aiPaused: true,
      aiPausedAt: new Date(),
      attendanceStatus: "FILA",
      ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
    },
  });
  return false;
}
```

3. Na **via principal**, resolva o modelo efetivo ANTES do gate e use-o no `getAiClient`:
```ts
  // Modelo efetivo = override do número, clampado pelo plano (strong só em plano que permite).
  const effectiveModel = await resolveAiModelForUser(lead.userId, company?.aiModel ?? null);
  if (mode.qualify || mode.reply) {
    if (!(await ensureAiCredit(lead, effectiveModel))) return; // cota estourada → fila humana
  }
  const ai = await getAiClient(lead.userId, effectiveModel ?? undefined);
```

4. Na **via de reunião (PROPOSED)**, o `interpretAndBook` também roda IA. Resolva o modelo e cobre:
```ts
  if (meeting?.status === "PROPOSED") {
    if (!(await aiStillActive(lead.id))) return;
    const effectiveModel = await resolveAiModelForUser(lead.userId, null); // PROPOSED não tem company carregada aqui
    if (!(await ensureAiCredit(lead, effectiveModel))) return;
    const lastInbound = await prisma.message.findFirst({ /* ...igual... */ });
    if (lastInbound) await interpretAndBook(lead.id, lastInbound.content);
    return;
  }
```
> A via PROPOSED hoje não carrega `company`; passar `null` cobra peso 1 (padrão econômico) — coerente, pois `interpretAndBook` não recebe modelo por número. Se quiser cobrar pelo modelo do número aqui também, carregue `whatsAppNumber.aiModel` antes (follow-up).

**Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 7: Rodar a suíte**

Run: `npx vitest run`
Expected: tudo verde.

**Step 8: Commit**
```bash
git add src/server/services/entitlements.ts src/server/services/entitlements.test.ts src/server/services/conversation.service.ts
git commit -m "feat(modelos): clamp de modelo por plano + peso no gate do respondToLead"
```

---

## Task 5: PATCH do número rejeita modelo strong sem permissão

**Files:**
- Modify: `src/app/api/numbers/[id]/route.ts` (ou `numbers.service.ts`, onde valida `aiModel`)
- Modify/Create: teste do PATCH (seguir o padrão de teste de rota já existente, se houver)

**Step 1: Localizar a validação**

Run: `npx grep -rn "ALL_AI_MODEL_VALUES\|aiModel" src/app/api/numbers src/server/services/numbers.service.ts`
Confirme onde o `aiModel` é validado no PATCH (Zod ou checagem manual contra `ALL_AI_MODEL_VALUES`).

**Step 2: Teste que falha (se houver harness de rota; senão, teste a função de serviço)**

Cenário: usuário de plano INICIAL tenta `PATCH { aiModel: "gpt-4o" }` → deve falhar com 4xx/erro "modelo não disponível no seu plano". E `aiModel: "gpt-4o-mini"` → ok.
> Se não houver teste de rota no repo, extraia a regra para uma função pura testável em `numbers.service.ts` (ex.: `assertModelAllowedForPlan(plan, aiModel)`) e teste-a unitariamente.

**Step 3: Implementar a checagem**

No fluxo do PATCH, após resolver o `tenantUserId` (dono) e antes de gravar:
```ts
import { modelTier } from "@/lib/ai-models";
import { PLAN_LIMITS } from "@/lib/plans";
// ...
if (aiModel && modelTier(aiModel) === "strong") {
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true, plan: true } });
  const unlimited = !owner?.plan || isAdminEmail(owner!.email);
  if (!unlimited && owner?.plan && !PLAN_LIMITS[owner.plan].allowStrongModel) {
    return jsonError("O modelo avançado não está disponível no seu plano. Faça upgrade ou use sua própria chave (BYOK).", 403);
  }
}
```
> Reuse o helper de erro/JSON da rota. BYOK não é checado aqui porque o clamp de runtime já libera BYOK; mas como a gravação é por número (independe de quem responde), manter a checagem por plano é seguro — o runtime ainda é a rede de segurança.

**Step 4: Type-check + rodar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: verde.

**Step 5: Commit**
```bash
git add src/app/api/numbers/ src/server/services/numbers.service.ts
git commit -m "feat(modelos): PATCH do numero rejeita modelo avancado sem permissao de plano"
```

---

## Task 6: UI — seletor de modelo por plano + medidores em créditos

**Files:**
- Modify: `src/components/WhatsAppNumbersPanel.tsx`
- Modify: `src/components/app/AccountSettings.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx`
- Modify: `src/app/(app)/financeiro/page.tsx`

**Step 1: Filtrar o seletor de modelo por plano**

O painel precisa saber se a conta permite strong. Passe `allowStrongModel` (do plano do dono) como prop ao `WhatsAppNumbersPanel` (a página que o renderiza calcula `PLAN_LIMITS[plan]?.allowStrongModel ?? false`; se `plan == null`/admin → `true`).

Em `WhatsAppNumbersPanel.tsx`, no `<select>` de modelo ([linha ~686](../../src/components/WhatsAppNumbersPanel.tsx#L686)), filtre as opções e marque o tier:
```tsx
{AI_MODELS_BY_PROVIDER[provider]
  .filter((m) => allowStrongModel || m.tier === "cheap")
  .map((m) => (
    <option key={m.value} value={m.value}>
      {m.label}{m.tier === "strong" ? " (avançado · 10 créditos)" : ""}
    </option>
  ))}
```
E, quando `!allowStrongModel`, um aviso curto abaixo: *"Modelos avançados disponíveis no Profissional/Escala ou com sua própria chave (BYOK)."*

**Step 2: Medidor de créditos em /configuracoes**

Em `AccountSettings.tsx`, o bloco de `aiUsage` passa a falar em **créditos** (a leitura `getAiUsageStatus` já devolve `used/quota` em créditos):
```tsx
Atendimentos de IA: <strong>{props.aiUsage.used} / {props.aiUsage.quota}</strong> créditos este mês
```
E uma linha de ajuda: *"Modelo econômico = 1 crédito por atendimento; modelo avançado = 10."*
> `configuracoes/page.tsx` já busca `getAiUsageStatus(ctx?.tenantUserId ?? userId)` — sem mudança de dados, só texto.

**Step 3: /financeiro mostra créditos (texto)**

Em `financeiro/page.tsx`, o rótulo `aiUsageLabel` já mostra `used / quota`; ajuste só o cabeçalho/uso para deixar claro que é crédito (ex.: header "IA (créditos/mês)"). A lógica de admin/BYOK/grandfather não muda.

**Step 4: Validar visualmente**

Run: `npm run dev`
- Número de conta INICIAL → seletor só mostra modelos econômicos + aviso.
- Conta PROFISSIONAL → mostra avançados marcados "(avançado · 10 créditos)".
- /configuracoes → "X / N créditos este mês".

**Step 5: Type-check + commit**
```bash
npx tsc --noEmit
git add src/components/WhatsAppNumbersPanel.tsx src/components/app/AccountSettings.tsx "src/app/(app)/configuracoes/page.tsx" "src/app/(app)/financeiro/page.tsx"
git commit -m "feat(modelos): seletor de modelo por plano + medidores em creditos"
```

---

## Task 7: Calibrar pools + nota de env

**Files:**
- Modify: `src/lib/plans.ts` (valores de `aiMonthlyQuota`)
- Modify: `src/lib/ai-models.ts` (`STRONG_CREDIT_WEIGHT`, se recalibrar)
- Doc: comentário/README de env

**Step 1: Definir os pools pelo custo real**

Com o modelo econômico escolhido para a plataforma, estime o custo de 1 atendimento cheap (≈ US$0,001 com mini). Defina o pool de cada plano como `teto_de_custo_aceito / custo_por_credito`. Sugestão inicial (recalibrar): INICIAL 300, PROFISSIONAL 6000, ESCALA 13000. Ajuste `STRONG_CREDIT_WEIGHT` para a razão de custo real strong/cheap (10 é placeholder).

**Step 2: Nota de env**

Garanta que `env.AI_MODEL_CHEAP` aponta para um modelo barato (ex.: `gpt-4o-mini`) e `env.AI_MODEL_STRONG` para um modelo **médio** (ex.: `gpt-4.1-mini` ou `gpt-4o`), já que a qualificação (tier strong interno) roda nele mesmo sem override por número. Documente no README/`.env.example`.

**Step 3: Commit**
```bash
git add src/lib/plans.ts src/lib/ai-models.ts
git commit -m "chore(modelos): calibrar pools de credito e peso do strong"
```

---

## Task 8: Verificação end-to-end

**Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde (evals de IA pulados sem `RUN_AI_EVALS=1`).

**Step 2: Build**

Run: `npm run build`
Expected: build conclui sem erro.

**Step 3: Teste manual (caminhos)**

1. Conta nova → nasce INICIAL; `/configuracoes` mostra `0 / 300 créditos`; seletor de modelo só econômico.
2. INICIAL com número em `gpt-4o` forçado via API → o `respondToLead` clampa p/ econômico; consumo sobe de 1 em 1.
3. Subir a conta para PROFISSIONAL no /financeiro → seletor libera avançado; número em `gpt-4o` → cada atendimento consome 10 créditos; ao faltar < 10, bloqueia e manda a mensagem de cota.
4. BYOK ativo → qualquer modelo, sem consumo.
5. Admin master → `ilimitado (admin)` no /financeiro; sem clamp.

**Step 4: Commit final (se houver ajustes)**
```bash
git add -A
git commit -m "test(modelos): verificacao e2e de modelos por plano + credito ponderado"
```

---

## Notas / follow-ups (fora do MVP)

- **Peso exato por chamada:** hoje cobra 1× o peso do modelo do número por atendimento. Cobrar a soma real (qualify strong + reply cheap) exigiria contabilizar pós-chamada — fica para quando houver telemetria de tokens.
- **Via PROPOSED por número:** cobra peso 1 (não carrega `company`). Carregar `whatsAppNumber.aiModel` na via de reunião alinharia o custo, se necessário.
- **Cobrança de excedente real:** em vez de bloquear, deixar passar e faturar créditos extras — exige gateway de pagamento.
- **Trial com features:** INICIAL no trial não tem qualify/schedule/campaigns. Se quiser que o trial experimente o PRO, criar um conceito de "trial tier" separado do plano comercial (decisão de produto).
- **Pricing page:** refletir "modelo avançado custa mais créditos" e "ilimitado com sua chave" na landing/`PricingPlans.tsx`.
- **Migração de contas existentes:** contas atuais com `plan = null` seguem grandfather (ilimitado, qualquer modelo). Se quiser capá-las, o admin atribui plano no /financeiro.
