# Multiusuário + Planos + Entitlements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Supersede:** absorve o plano `2026-06-27-plano-da-conta-admin.md` (o campo `plan` continua no `User`, agora junto de `ownerId`/`role`). Pode descartar aquele doc.

**Goal:** Transformar a conta de single-user em **multiusuário com papéis** (admin provisiona operadores que compartilham o mesmo CRM), atrelar cada conta a um **plano** (Inicial/Profissional/Escala) e **aplicar a régua de entitlements** (nº de chips, nº de seats, features) no código. Atualizar a landing pra refletir a nova precificação e remover o vaporware.

**Architecture:** Tenancy **por dono**, não por `Organization`. O `User` continua sendo o tenant. Adiciona-se `User.ownerId` (self-relation: null = dono/admin da conta; preenchido = operador daquele dono) e `User.role`. Todos os dados (Lead/Campaign/WhatsAppNumber/Payment/billing/plano) continuam pendurados no **dono**. Um operador é um login adicional que, ao agir, **resolve para o `userId` do dono** via um helper único `getTenantUserId()`. Isso evita re-escopar 46 arquivos: troca-se apenas a fronteira (~30 pontos de entrada) e gateia-se por papel. Entitlements são um mapa estático `PLAN_LIMITS` consultado nos pontos de criação (número/operador/campanha).

**Tech Stack:** Next.js (App Router, server components + route handlers), Prisma + PostgreSQL, Zod, Vitest, TypeScript.

**Glossário:**
- **Dono / admin da conta:** `User` com `ownerId = null`, `role = ADMIN`. Quem assina e paga. Tenant.
- **Operador:** `User` com `ownerId = <id do dono>`, `role = OPERADOR`. Compartilha os dados do dono.
- **tenantUserId:** o `userId` que escopa os dados = `session.ownerId ?? session.id`.
- **Admin da plataforma:** `isAdminEmail(email)` — VOCÊ. Bypassa entitlements e acessa `/financeiro`. Não confundir com "admin da conta".

**Decisões travadas (não relitigar durante a execução):**
- Operador é provisionado pelo admin da conta (nome + e-mail + **senha definida pelo admin**). Sem convite por e-mail, sem token.
- `plan` vive no dono (`User`). Conta nova nasce sem plano (`null`).
- **Grandfathering:** `plan = null` → entitlements **não** são aplicados (contas legadas/admin seguem livres). A régua só morde depois que um plano é atribuído.
- Tenancy por `ownerId` (não `Organization`). Console de agência (modelo B) fica adiado.
- Atribuição de lead a operador específico (quem-atendeu) está **fora de escopo** — tudo escopa no dono.

**Tabela de planos (fonte da verdade = `PLAN_LIMITS`):**

| Plano | Preço (centavos) | maxNumbers | maxSeats | qualify | schedule | campaigns |
|---|---|---|---|---|---|---|
| INICIAL | 12700 | 1 | 2 | ❌ | ❌ | ❌ |
| PROFISSIONAL | 24700 | 2 | 5 | ✅ | ✅ | ✅ |
| ESCALA | 49700 | 4 | 10 | ✅ | ✅ | ✅ |

`maxSeats` inclui o admin da conta (2 = admin + 1 operador).

---

## Fase 1 — Modelo de dados (ownerId + role + plan)

### Task 1.1: Schema — enums + campos no `User`

**Files:**
- Modify: `prisma/schema.prisma` (enums perto da linha 33; campos no `model User` ~linha 50; relação self ~linha 61-68)

**Step 1: Adicionar enums** (após `PaymentMethod`, ~linha 33):

```prisma
enum Plan {
  INICIAL
  PROFISSIONAL
  ESCALA
}

enum AccountRole {
  ADMIN     // dono da conta — billing, equipe, números
  OPERADOR  // atende/CRM; sem billing nem gestão de equipe
}
```

**Step 2: Adicionar campos + self-relation no `model User`.**

Junto das anotações financeiras (após `paymentDueDate DateTime?`):

```prisma
  // Plano comercial do DONO (null = não definido → entitlements não aplicados).
  plan            Plan?
  // Papel dentro da conta. Dono = ADMIN; operadores criados pelo admin = OPERADOR.
  role            AccountRole @default(ADMIN)
  // Tenancy por dono: null = este User É o dono (tenant). Preenchido = operador
  // que compartilha os dados do dono. Billing/plano só fazem sentido no dono.
  ownerId         String?
  owner           User?       @relation("AccountMembers", fields: [ownerId], references: [id], onDelete: Cascade)
  members         User[]      @relation("AccountMembers")
```

**Step 3: Aplicar e regenerar.**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

Run: `npx prisma generate`
Expected: tipos `Plan`, `AccountRole` e os campos disponíveis em `@prisma/client`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(tenancy): User.ownerId + role + plan (multiusuario por dono)"
```

### Task 1.2: `PLAN_LIMITS` — fonte única da régua

**Files:**
- Create: `src/lib/plans.ts`
- Test: `src/lib/plans.test.ts`

**Step 1: Escrever o teste que falha** (`src/lib/plans.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, planLabel } from "./plans";

describe("PLAN_LIMITS", () => {
  it("define os três planos com os limites travados", () => {
    expect(PLAN_LIMITS.INICIAL).toMatchObject({ maxNumbers: 1, maxSeats: 2, campaigns: false });
    expect(PLAN_LIMITS.PROFISSIONAL).toMatchObject({ maxNumbers: 2, maxSeats: 5, campaigns: true });
    expect(PLAN_LIMITS.ESCALA).toMatchObject({ maxNumbers: 4, maxSeats: 10, campaigns: true });
  });
  it("planLabel devolve o rótulo PT-BR", () => {
    expect(planLabel("PROFISSIONAL")).toBe("Profissional");
    expect(planLabel(null)).toBe("—");
  });
});
```

**Step 2: Rodar e ver falhar.**
Run: `npx vitest run src/lib/plans.test.ts` → FAIL (módulo inexistente).

**Step 3: Implementar** (`src/lib/plans.ts`):

```ts
import type { Plan } from "@prisma/client";

export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;   // inclui o admin da conta
  qualify: boolean;   // pode ligar qualifyEnabled por número
  schedule: boolean;  // pode ligar scheduleEnabled por número
  campaigns: boolean; // pode criar/rodar campanha
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 12700, maxNumbers: 1, maxSeats: 2,  qualify: false, schedule: false, campaigns: false },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  qualify: true,  schedule: true,  campaigns: true  },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, qualify: true,  schedule: true,  campaigns: true  },
};

const LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

export function planLabel(plan: Plan | null): string {
  return plan ? LABELS[plan] : "—";
}
```

**Step 4: Rodar e ver passar.**
Run: `npx vitest run src/lib/plans.test.ts` → PASS.

**Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(planos): PLAN_LIMITS como fonte unica de entitlements"
```

---

## Fase 2 — Resolução de tenant (a fronteira)

### Task 2.1: helper `getTenantUserId` / `getSessionContext`

**Files:**
- Read primeiro: `src/lib/session.ts` (entender `getCurrentUserId`), `src/lib/auth.ts`
- Modify ou Create: `src/lib/tenant.ts`
- Test: `src/lib/tenant.test.ts`

**Step 1: Teste que falha** (`src/lib/tenant.test.ts`) — mocka `prisma.user.findUnique`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("resolveTenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dono: tenantUserId = próprio id", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "dono-1", ownerId: null, role: "ADMIN" });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("dono-1")).toEqual({ sessionUserId: "dono-1", tenantUserId: "dono-1", role: "ADMIN" });
  });

  it("operador: tenantUserId = ownerId", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "op-1", ownerId: "dono-1", role: "OPERADOR" });
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("op-1")).toEqual({ sessionUserId: "op-1", tenantUserId: "dono-1", role: "OPERADOR" });
  });

  it("usuário inexistente: null", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const { resolveTenant } = await import("./tenant");
    expect(await resolveTenant("ghost")).toBeNull();
  });
});
```

**Step 2: Rodar e ver falhar.** `npx vitest run src/lib/tenant.test.ts` → FAIL.

**Step 3: Implementar** (`src/lib/tenant.ts`):

```ts
import { prisma } from "@/server/db/client";
import { getCurrentUserId } from "@/lib/session";
import type { AccountRole } from "@prisma/client";

export interface TenantContext {
  sessionUserId: string; // quem está logado (operador ou dono) — auditoria/permissão
  tenantUserId: string;  // dono que escopa os DADOS (ownerId ?? id)
  role: AccountRole;
}

/** Resolve o contexto de tenant a partir de um userId de sessão. */
export async function resolveTenant(sessionUserId: string): Promise<TenantContext | null> {
  const u = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, ownerId: true, role: true },
  });
  if (!u) return null;
  return { sessionUserId: u.id, tenantUserId: u.ownerId ?? u.id, role: u.role };
}

/** Atalho p/ rotas: lê o cookie de sessão e resolve o contexto (ou null). */
export async function getTenantContext(): Promise<TenantContext | null> {
  const sid = await getCurrentUserId();
  return sid ? resolveTenant(sid) : null;
}

/** Só o id que escopa os dados (ou null se não logado). */
export async function getTenantUserId(): Promise<string | null> {
  const ctx = await getTenantContext();
  return ctx?.tenantUserId ?? null;
}
```

**Step 4: Rodar e ver passar.** `npx vitest run src/lib/tenant.test.ts` → PASS.

**Step 5: Commit**

```bash
git add src/lib/tenant.ts src/lib/tenant.test.ts
git commit -m "feat(tenancy): resolveTenant/getTenantUserId (operador resolve pro dono)"
```

### Task 2.2: trocar os pontos de entrada de dados para `getTenantUserId`

**Contexto:** hoje ~30 arquivos chamam `getCurrentUserId()` e usam o id direto como escopo. Precisamos separar dois usos:
- **Escopo de DADOS** (leads, campanhas, números, conversas) → passa a usar `getTenantUserId()`.
- **Ações da PRÓPRIA conta logada** (trocar senha, chave de IA, exportar/excluir a própria conta, verificação de e-mail) → continuam em `getCurrentUserId()` (é sobre o usuário logado, não o tenant).

**Files (trocar para `getTenantUserId`):**
- `src/app/(app)/leads/page.tsx`, `src/app/api/leads/route.ts`, `src/app/api/leads/[id]/route.ts`, `src/app/api/leads/[id]/reply/route.ts`, `src/app/api/leads/[id]/handoff/route.ts`, `src/app/api/leads/import/route.ts`
- `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[id]/route.ts`, `src/app/api/campaigns/[id]/start/route.ts`, `src/app/api/campaigns/[id]/progress/route.ts`
- `src/app/api/numbers/route.ts`, `src/app/api/numbers/[id]/route.ts`, `src/app/api/numbers/[id]/reconnect/route.ts`
- `src/app/api/meetings/route.ts`

**Files (MANTER `getCurrentUserId` — não tocar no escopo):**
- `src/app/api/account/change-password/route.ts`, `src/app/api/account/ai-key/route.ts`, `src/app/api/account/export/route.ts`, `src/app/api/account/delete/route.ts`, `src/app/api/auth/resend-verification/route.ts`, `src/app/(app)/configuracoes/page.tsx`

**Files (admin da plataforma — não tocar):**
- `src/app/(app)/financeiro/page.tsx`, `src/app/api/admin/**`

**Step 1:** Para cada arquivo da primeira lista, leia-o e substitua o uso de escopo de dados:

```ts
// antes
const userId = await getCurrentUserId();
// ... where: { userId }
// depois
import { getTenantUserId } from "@/lib/tenant";
const userId = await getTenantUserId(); // tenant (dono); operador cai no mesmo escopo
```

Mantenha a guarda de "não logado → 401/redirect" idêntica. **Não mude a forma das queries** — só a origem do `userId`.

**Step 2: Verificação de tipos.** Run: `npx tsc --noEmit` → sem erros.

**Step 3: Verificação manual (smoke).** `npm run dev`, logado como dono: leads, campanhas e números continuam aparecendo igual (regressão zero — o dono resolve pro próprio id).

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(tenancy): escopo de dados via getTenantUserId nos pontos de entrada"
```

> **Nota de execução:** faça em commits pequenos por área (leads / campaigns / numbers / meetings) pra revisar em blocos. Cada bloco é um sub-commit.

---

## Fase 3 — Provisionar operadores (a tela "Equipe")

### Task 3.1: service `createOperator` / `listMembers` / `removeOperator`

**Files:**
- Create: `src/server/services/team.service.ts`
- Test: `src/server/services/team.service.test.ts`
- Reusar: `hashPassword` de `@/lib/password`, `normalizeEmail` de `@/lib/email`, `PLAN_LIMITS` de `@/lib/plans`

**Regras (cobrir com teste):**
- Só o **dono (ADMIN)** cria operadores. Operador chamando → erro.
- Conta do dono tem **limite de seats** = `PLAN_LIMITS[plan].maxSeats` (conta o próprio dono + operadores). Sem plano (`null`) → bloqueia criação com mensagem clara ("defina um plano para adicionar usuários"). Estourou o teto → erro.
- E-mail único global (igual `registerUser`).
- Operador nasce: `ownerId = dono.id`, `role = OPERADOR`, `passwordHash = hash(senhaDefinidaPeloAdmin)`, **sem** campos de billing/plano.

**Step 1: Teste que falha** — esboço dos casos:

```ts
// - createOperator por OPERADOR → rejeita /apenas o administrador/i
// - createOperator com plano null → rejeita /defina um plano/i
// - createOperator no limite de seats (INICIAL: dono + 1 já existe) → rejeita /limite/i
// - createOperator OK (PROFISSIONAL, 1 seat usado) → prisma.user.create com ownerId/role/hash
// - createOperator e-mail duplicado → rejeita /já existe/i
```

(Mocke `prisma.user.findUnique`, `prisma.user.count`, `prisma.user.create` no mesmo estilo de `account.service.test.ts`.)

**Step 2: Rodar e ver falhar.**

**Step 3: Implementar `team.service.ts`** com a assinatura:

```ts
export async function createOperator(adminUserId: string, input: { name: string; email: string; password: string }): Promise<{ id: string }>;
export async function listMembers(adminUserId: string): Promise<Array<{ id: string; name: string; email: string; role: AccountRole; createdAt: Date }>>;
export async function removeOperator(adminUserId: string, operatorId: string): Promise<void>; // valida que o operador pertence a este dono
```

A contagem de seats: `prisma.user.count({ where: { OR: [{ id: adminUserId }, { ownerId: adminUserId }] } })` comparado a `PLAN_LIMITS[plan].maxSeats`.

**Step 4: Rodar e ver passar.**

**Step 5: Commit** `feat(equipe): service de provisionamento de operadores com limite de seats`

### Task 3.2: rotas da equipe

**Files:**
- Create: `src/app/api/team/route.ts` (GET listMembers, POST createOperator)
- Create: `src/app/api/team/[id]/route.ts` (DELETE removeOperator)

Cada rota: resolve `getTenantContext()`, exige `role === "ADMIN"` (senão 403), valida body com Zod (`name`, `email`, `password` min 8), chama o service, devolve `{ ok }` ou erro amigável. Espelha o padrão de `src/app/api/admin/accounts/[id]/billing/route.ts`.

**Commit:** `feat(equipe): rotas /api/team (criar/listar/remover operador)`

### Task 3.3: UI "Equipe"

**Files:**
- Create: `src/app/(app)/equipe/page.tsx` (server component: lista membros; só dono/ADMIN acessa, senão card "acesso restrito" igual ao `/financeiro`)
- Create: `src/components/app/TeamManager.tsx` (client: form criar operador + lista com remover)
- Modify: navegação do app (onde fica o menu lateral — provavelmente `src/app/(app)/layout.tsx` ou um componente de nav) pra adicionar o link "Equipe" **visível só pro ADMIN**.

**Verificação manual:** como dono PROFISSIONAL, criar operador → logar com as credenciais → operador vê os mesmos leads/números; operador **não** vê "Equipe" nem "Financeiro".

**Commit:** `feat(equipe): tela de gestao de operadores (somente admin da conta)`

---

## Fase 4 — Gating por papel (operador não-admin)

### Task 4.1: bloquear áreas de admin-da-conta para operador

**Files:**
- Modify: `src/app/api/team/**` (já exige ADMIN — confirmar)
- Modify: rotas/áreas que só o dono deve mexer: gestão de **números** (`src/app/api/numbers/**`) e **billing self** — decidir política: operador pode operar atendimento, mas criar/remover número é do ADMIN.
- Modify: nav — esconder "Equipe" e "Configurações de billing" do operador.

**Regra:** adicionar guarda `if (ctx.role !== "ADMIN") return 403` nas rotas de mutação de infraestrutura da conta (criar/remover número, equipe). Leitura e atendimento (leads, conversas, responder, handoff) ficam liberados pro operador.

**Test:** uma rota representativa (`POST /api/numbers`) rejeita operador com 403.

**Commit:** `feat(papeis): gating de operador (sem numeros/equipe/billing)`

---

## Fase 5 — Entitlements (a régua mordendo)

### Task 5.1: limite de números por plano

**Files:**
- Modify: `src/server/services/numbers.service.ts` (no ponto de criação de `WhatsAppNumber`)
- Test: `src/server/services/numbers.service.test.ts` (criar/estender)

**Regra:** antes de criar número, se o dono tem `plan != null`, contar números existentes do tenant e bloquear se `>= PLAN_LIMITS[plan].maxNumbers` (mensagem: "seu plano permite N números"). `plan == null` → sem limite (grandfather). `isAdminEmail` → sem limite.

**Step 1-4:** TDD — teste que falha (no limite → rejeita), implementar a checagem, ver passar.

**Commit:** `feat(entitlements): teto de numeros por plano`

### Task 5.2: gating de features (qualificação / agendamento / campanhas)

**Files:**
- Modify: onde `qualifyEnabled`/`scheduleEnabled` são ligados por número (provável `numbers.service.ts`): se o plano não permite, recusar habilitar.
- Modify: criação/`start` de campanha (`src/server/services/campaign.service.ts` e/ou `src/app/api/campaigns/**`): se `!PLAN_LIMITS[plan].campaigns`, recusar com mensagem.
- Test: casos de recusa por plano (INICIAL não cria campanha; INICIAL não liga qualify).

**Commit:** `feat(entitlements): gating de qualificacao/agendamento/campanhas por plano`

> Seats já são gateados na Task 3.1.

---

## Fase 6 — Plano no admin da plataforma + landing

### Task 6.1: atribuir plano no `/financeiro` (absorve o plano-rótulo antigo)

**Files:**
- Modify: `src/server/services/account.service.ts` — ação `setPlan` em `AccessAction`/`setAccountAccess` (idêntico ao plano `2026-06-27-plano-da-conta-admin.md`, Task 2); `AdminAccountRow` ganha `plan`. **`listAccountsForAdmin` deve listar só DONOS** (`where: { ownerId: null }`) — operadores não são contas faturáveis.
- Modify: `src/app/api/admin/accounts/[id]/billing/route.ts` — schema aceita `setPlan`.
- Modify: `src/components/app/AccountAccessModal.tsx` — seletor de plano (usar `planLabel`/`PLAN_LIMITS`).
- Modify: `src/app/(app)/financeiro/page.tsx` — coluna "Plano" + nova coluna "Seats" (ex.: `usados/maxSeats`) opcional; passar `plan` ao modal.

**Test:** `setPlan` grava sem tocar acesso/override (reaproveita os testes já escritos no plano anterior).

**Commit:** `feat(planos): admin atribui plano da conta no financeiro`

### Task 6.2: atualizar a landing (preços + specs + remover vaporware)

**Files:**
- Modify: `src/components/marketing/Landing.tsx` — `PLANS` (linha ~60-91):
  - Inicial **R$127**: "1 número de WhatsApp", "**2 usuários**", "Atendimento com IA", "CRM + Kanban", "Importação por CSV".
  - Profissional **R$247**: "2 números", "**5 usuários**", "Qualificação por IA", "Agendamento e lembretes", "Campanhas", "Cadência humana e aquecimento".
  - Escala **R$497**: "4 números", "**10 usuários**", "Suporte prioritário", "Onboarding assistido". **Remover "Acesso à API" e "Multiusuário"** (multiusuário agora é transversal; API não existe).
- Revisar o copy do header de preços se citar "economia/anual" (manter coerente).

**Verificação manual:** abrir a landing, conferir os três cards.

**Commit:** `feat(landing): nova precificacao 127/247/497 + specs reais (remove API)`

### Task 6.3: toggle Mensal/Anual nos cards de preço

**Contexto:** a landing promete "no plano anual você economiza 2 meses" ([Landing.tsx:305](../../src/components/marketing/Landing.tsx#L305)) mas só mostra preço `/mês` e **não tem toggle** — promessa vazia. Anual aqui é só cadência de pagamento: **sem mudança de schema**. Quando o cliente paga anual, o admin lança no `/financeiro` com `accessUntil = +12 meses` e o `amountCents` anual. Desconto = pagar 10, levar 12 → **preço anual = mensal × 10**.

**Files:**
- Modify: `src/components/marketing/Landing.tsx` — `PLANS` passa a ter preço **numérico mensal** (ex.: `priceMonthly: 127`) em vez da string `"R$97"`; o bloco de preço passa a ser renderizado por um componente client com o toggle.
- Create: `src/components/marketing/PricingPlans.tsx` (client component: estado `period: "mensal" | "anual"`, o switch, e os cards).

> Verifique primeiro se `Landing.tsx` já é `"use client"`. Se já for, basta adicionar o `useState` do toggle ali e não precisa do componente novo. Se for server component, extraia a seção de planos para `PricingPlans.tsx` (`"use client"`) recebendo `PLANS` por prop.

**Step 1: Estado e cálculo.** No componente client:

```tsx
const [period, setPeriod] = useState<"mensal" | "anual">("mensal");
// anual = mensal × 10 (paga 10, leva 12). Exibe o total/ano e o equivalente/mês.
const fmt = (n: number) => `R$${n.toLocaleString("pt-BR")}`;
function priceLabel(monthly: number) {
  if (period === "mensal") return { big: fmt(monthly), suffix: "/mês" };
  const yearly = monthly * 10;
  return { big: fmt(yearly), suffix: "/ano", hint: `equivale a ${fmt(Math.round(yearly / 12))}/mês` };
}
```

**Step 2: Toggle.** Renderizar acima dos cards um switch de dois estados (Mensal | Anual) com um selo "economize 2 meses" no Anual. Estilo coerente com o resto da landing (Tailwind, mesmas cores).

**Step 3: Cards.** Trocar o `<span>{p.price}</span> <span>/mês</span>` ([linha ~329-330](../../src/components/marketing/Landing.tsx#L329-L330)) por `priceLabel(p.priceMonthly)` — `big` + `suffix`, e o `hint` (equivalente/mês) abaixo, em texto pequeno, só no modo anual.

**Step 4: Verificação manual.** `npm run dev` → landing: alternar Mensal/Anual troca os três preços e os sufixos; Anual mostra "R$1.270/ano · equivale a R$106/mês" no Inicial.

**Step 5: Commit**

```bash
git add src/components/marketing/Landing.tsx src/components/marketing/PricingPlans.tsx
git commit -m "feat(landing): toggle Mensal/Anual nos planos (anual = mensal x10)"
```

---

## Checklist final

- [ ] `npx vitest run` — suíte verde (tenant, plans, team, numbers, account)
- [ ] `npx tsc --noEmit` — sem erros
- [ ] Dono cria operador dentro do limite de seats; operador vê o mesmo CRM
- [ ] Operador **não** acessa Equipe/Financeiro/gestão de números (403/escondido)
- [ ] Plano INICIAL bloqueia 2º número, campanha e qualificação; PROFISSIONAL libera
- [ ] Conta com `plan = null` continua sem restrição (grandfather)
- [ ] `/financeiro` lista só donos; atribuição de plano funciona e não mexe no acesso
- [ ] Landing mostra 127/247/497 com specs reais e sem "API/Multiusuário" no Escala
- [ ] Toggle Mensal/Anual funciona (anual = mensal ×10, mostra equivalente/mês)

## Fora de escopo (próximas conversas)

- Console de agência (modelo B): 1 operador gerenciando vários clientes isolados → migrar `ownerId` para `Organization` + seletor de workspace.
- Atribuição de lead/conversa a operador específico (auditoria de quem-atendeu) + filtros por operador.
- Medição/cobrança por volume de disparo e reconciliação Baileys vs Cloud API.
- Cobrança automática (gateway) — hoje o acesso é liberado manualmente pelo admin no `/financeiro`.
- Posicionamento "atendimento-first" (caso cartório) como tier consultivo dedicado.
```

