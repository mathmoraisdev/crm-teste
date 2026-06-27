# Trial Automático + Prazo de Acesso (validade por data) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Trocar o liga/desliga manual (`billingActive Boolean`) por um **prazo de acesso por data** (`accessUntil`): cadastro novo ganha trial automático (3/7 dias via env), o acesso expira sozinho **em tempo real** (sem cron) e o admin estende/força pelo painel — com **override manual** que ganha da data (modelo híbrido).

**Architecture:**
- Duas decisões já tomadas: **(1) suspensão por data em tempo real** — os gates já são chamados a cada inbound/outbound, então basta comparar `accessUntil > agora` na hora, sem worker/cron novo; **(2) modelo híbrido** — `accessUntil` controla o automático, mas um enum `billingOverride { AUTO, ACTIVE, SUSPENDED }` permite forçar/liberar manualmente preservando a data.
- O ponto de ouro: os gates já são **centralizados** em `isAccountActive(userId)` e `isAccountActiveByLead(leadId)` ([account.service.ts](../../src/server/services/account.service.ts)). Trocamos só o **miolo** dessas funções (e os `where` do dispatcher) — `conversation.service`, `campaigns` route e o gate de inbound **não mudam**.
- Função pura `accountActive({ billingOverride, accessUntil }, now)` decide tudo num lugar só, testável isolada. Override `SUSPENDED` cala mesmo com data futura; `ACTIVE` libera mesmo com data vencida; `AUTO` segue a data.
- Migração **não-destrutiva**: `billingActive` fica no schema durante a transição; um backfill mapeia `true→ACTIVE`, `false→SUSPENDED`; só na fase final a coluna velha é removida.

**Tech Stack:** Next.js (App Router, server components), Prisma + PostgreSQL (`db push`, não `migrate`), Baileys worker, Vitest (`vi.mock` do prisma), TypeScript, lucide-react, Tailwind.

---

## Convenções deste repositório (leia antes de começar)

- **Migrations:** `npx prisma db push` (não `migrate dev`) — ver topo de [prisma/schema.prisma](../../prisma/schema.prisma). Coluna nova nullable + enum + coluna com default = **aditivo**. **Atenção:** `billingOverride @default(AUTO)` faz contas existentes nascerem `AUTO` com `accessUntil = null` → ficariam **suspensas**. Por isso o **backfill** (Task 1.3) roda logo após o push, antes de trocar os reads.
- **Testes:** Vitest, alias `@/` ([vitest.config.ts](../../vitest.config.ts)). Padrão: `vi.mock("@/server/db/client", () => ({ prisma: { ... } }))`. Modelo em [src/server/services/account.service.test.ts](../../src/server/services/account.service.test.ts).
- **Rodar um teste:** `npx vitest run <caminho> -t "<nome>"`.
- **`Date.now()` em testes:** use `vi.setSystemTime(new Date("2026-06-27T12:00:00Z"))` com `vi.useFakeTimers()`/`vi.useRealTimers()` para datas determinísticas.
- **Admin idiom (já em uso):** `isAdminEmail(email)` de [src/lib/admin.ts](../../src/lib/admin.ts).
- **Commits:** frequentes, um por tarefa, pt-BR no estilo do repo (`feat(financeiro): ...`).
- **Smoke existente:** [scripts/smoke-financeiro.ts](../../scripts/smoke-financeiro.ts) referencia `billingActive` direto — será atualizado na Phase 6.

---

## Mapa de impacto (onde `billingActive` é lido hoje)

| Arquivo | Uso | O que acontece no plano |
|---|---|---|
| `prisma/schema.prisma` | coluna | + `accessUntil`, + `billingOverride`; remove `billingActive` na Phase 6 |
| `src/server/services/account.service.ts` | 4 funções | miolo trocado p/ `accountActive()` + datas |
| `src/server/services/conversation.service.ts:191` | chama `isAccountActiveByLead` | **não muda** |
| `src/app/api/campaigns/route.ts:33` + `[id]/start/route.ts:15` | chamam `isAccountActive` | **não muda** |
| `src/server/worker/dispatcher.ts:119,165` | `where` Prisma | filtro reescrito p/ override+data |
| `src/server/services/user.service.ts:46` | `registerUser` | grava trial (`accessUntil`) |
| `src/app/(app)/financeiro/page.tsx` | tabela | mostra validade + dias restantes |
| `src/components/app/AccountBillingToggle.tsx` | toggle | vira modal de gestão de prazo |
| `scripts/smoke-financeiro.ts` | smoke | atualizado p/ novo modelo |

---

## Phase 0 — Função pura `accountActive` (o coração, testado isolado)

Construímos a lógica de decisão ANTES de tocar no banco/UI. Sem Prisma, sem I/O.

### Task 0.1: Helper puro de status de acesso

**Files:**
- Create: `src/lib/billing.ts`
- Test: `src/lib/billing.test.ts`

**Step 1: Escrever o teste que falha**

```typescript
// src/lib/billing.test.ts
import { describe, it, expect } from "vitest";
import { accountActive, daysRemaining } from "./billing";

const NOW = new Date("2026-06-27T12:00:00Z");
const FUTURE = new Date("2026-07-10T12:00:00Z");
const PAST = new Date("2026-06-01T12:00:00Z");

describe("accountActive", () => {
  it("AUTO + data futura = ativo", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: FUTURE }, NOW)).toBe(true);
  });
  it("AUTO + data vencida = suspenso", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: PAST }, NOW)).toBe(false);
  });
  it("AUTO + sem data = suspenso", () => {
    expect(accountActive({ billingOverride: "AUTO", accessUntil: null }, NOW)).toBe(false);
  });
  it("SUSPENDED ganha da data futura (kill switch)", () => {
    expect(accountActive({ billingOverride: "SUSPENDED", accessUntil: FUTURE }, NOW)).toBe(false);
  });
  it("ACTIVE ganha da data vencida (cortesia)", () => {
    expect(accountActive({ billingOverride: "ACTIVE", accessUntil: PAST }, NOW)).toBe(true);
  });
  it("ACTIVE mesmo sem data = ativo", () => {
    expect(accountActive({ billingOverride: "ACTIVE", accessUntil: null }, NOW)).toBe(true);
  });
});

describe("daysRemaining", () => {
  it("conta dias inteiros para frente (arredonda p/ cima)", () => {
    expect(daysRemaining(FUTURE, NOW)).toBe(13);
  });
  it("data vencida = 0 (nunca negativo)", () => {
    expect(daysRemaining(PAST, NOW)).toBe(0);
  });
  it("sem data = null", () => {
    expect(daysRemaining(null, NOW)).toBe(null);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/billing.test.ts`
Expected: FAIL — `Cannot find module './billing'`.

**Step 3: Implementar o mínimo**

```typescript
// src/lib/billing.ts

/** Override manual do admin sobre o prazo automático (modelo híbrido). */
export type BillingOverride = "AUTO" | "ACTIVE" | "SUSPENDED";

/** Campos de billing que decidem se a conta funciona. */
export interface AccountAccess {
  billingOverride: BillingOverride;
  accessUntil: Date | null;
}

/**
 * True se a conta está ativa AGORA. Híbrido:
 *  - SUSPENDED: cala sempre (mesmo com data futura) — kill switch manual.
 *  - ACTIVE: libera sempre (mesmo vencida) — cortesia/grace manual.
 *  - AUTO: segue a data — ativo só enquanto `accessUntil` está no futuro.
 * Sem data + AUTO = suspenso (conta nunca liberada). Em tempo real, sem cron.
 */
export function accountActive(acc: AccountAccess, now: Date = new Date()): boolean {
  if (acc.billingOverride === "SUSPENDED") return false;
  if (acc.billingOverride === "ACTIVE") return true;
  return acc.accessUntil != null && acc.accessUntil.getTime() > now.getTime();
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Dias inteiros restantes (arredonda p/ cima). Vencido = 0; sem data = null. */
export function daysRemaining(accessUntil: Date | null, now: Date = new Date()): number | null {
  if (accessUntil == null) return null;
  const diff = accessUntil.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

/** Soma `days` a uma base, partindo de `max(base, now)` (não encurta prazo vigente). */
export function addDays(base: Date | null, days: number, now: Date = new Date()): Date {
  const start = base && base.getTime() > now.getTime() ? base : now;
  return new Date(start.getTime() + days * DAY_MS);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/billing.test.ts`
Expected: PASS (9 testes).

**Step 5: Commit**

```bash
git add src/lib/billing.ts src/lib/billing.test.ts
git commit -m "feat(financeiro): helper puro accountActive/daysRemaining (prazo por data)"
```

---

## Phase 1 — Schema: `accessUntil` + `billingOverride` + backfill

### Task 1.1: Adicionar enum e colunas no schema

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, ~linha 33; enum perto de `AiProvider`)

**Step 1: Adicionar o enum** (logo após o bloco `enum AiProvider { ... }`, ~linha 20):

```prisma
enum BillingOverride {
  AUTO       // segue o prazo (accessUntil)
  ACTIVE     // forçado ativo pelo admin (ganha da data)
  SUSPENDED  // forçado suspenso pelo admin (ganha da data)
}

enum PaymentMethod {
  PIX
  CARTAO
  BOLETO
  TRANSFERENCIA
}
```

**Step 2: No `model User`**, logo abaixo da linha `billingActive Boolean @default(true)` (linha 33), adicionar:

```prisma
  // Prazo de acesso (trial ou pago): a conta funciona enquanto `accessUntil` está
  // no futuro. Expira em tempo real (sem cron) — os gates comparam na hora.
  // `billingOverride` permite forçar/liberar manualmente preservando a data.
  // `billingActive` fica como vestígio durante a transição (removido na Phase 6).
  accessUntil     DateTime?
  billingOverride BillingOverride @default(AUTO)
  // Anotação financeira (NÃO afeta o acesso — só registro do admin): como o
  // cliente paga e quando vence a próxima mensalidade. Ambos opcionais.
  paymentMethod   PaymentMethod?
  paymentDueDate  DateTime?
```

**Step 3: Aplicar no banco**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema`. Colunas novas: `accessUntil = NULL`, `billingOverride = 'AUTO'`, `paymentMethod = NULL`, `paymentDueDate = NULL` em todas as linhas. **Ainda não troque reads** — o backfill (Task 1.3) corrige `billingOverride` antes (os campos de anotação ficam null mesmo).

**Step 4: Regerar o client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(financeiro): schema accessUntil + billingOverride (enum)"
```

### Task 1.2: Script de backfill (preserva contas existentes)

**Files:**
- Create: `scripts/backfill-billing-override.ts`

**Step 1: Implementar o script**

```typescript
// scripts/backfill-billing-override.ts
// Mapeia o estado antigo (billingActive) para o novo override, sem perder nada:
//   billingActive=true  -> billingOverride=ACTIVE  (conta segue funcionando)
//   billingActive=false -> billingOverride=SUSPENDED
// Idempotente: rode quantas vezes quiser. Roda UMA vez na migração.
import { prisma } from "@/server/db/client";

async function main() {
  const toActive = await prisma.user.updateMany({
    where: { billingActive: true },
    data: { billingOverride: "ACTIVE" },
  });
  const toSuspended = await prisma.user.updateMany({
    where: { billingActive: false },
    data: { billingOverride: "SUSPENDED" },
  });
  console.log(`ACTIVE: ${toActive.count} | SUSPENDED: ${toSuspended.count}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

**Step 2: Rodar o backfill** (o repo usa `tsx` p/ scripts — confira `package.json`):

Run: `npx tsx scripts/backfill-billing-override.ts`
Expected: imprime as contagens. Sua conta admin (`billingActive=true`) vira `ACTIVE` → continua funcionando.

**Step 3: Commit**

```bash
git add scripts/backfill-billing-override.ts
git commit -m "chore(financeiro): backfill billingActive -> billingOverride"
```

> **Por que ACTIVE e não AUTO+data:** quem já estava ativo não tinha prazo; mapear p/ `ACTIVE` mantém o comportamento idêntico (funciona sem data). Você define prazos depois, conta a conta, pelo modal. Cadastros NOVOS já nascem com data de trial (Phase 3).

---

## Phase 2 — Trocar o miolo dos gates (datas em vez de booleano)

Os gates externos (`conversation.service`, `campaigns` route) **não mudam** — só o interno de `account.service` e o `where` do dispatcher.

### Task 2.1: `account.service` lê override+data via `accountActive`

**Files:**
- Modify: `src/server/services/account.service.ts`
- Modify: `src/server/services/account.service.test.ts`

**Step 1: Reescrever os testes do service** (substituir o arquivo de teste). Ele passa a mockar `accessUntil`/`billingOverride`:

```typescript
// src/server/services/account.service.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ADMIN_EMAILS = "admin@exemplo.com";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

const FUTURE = new Date("2026-07-10T12:00:00Z");
const PAST = new Date("2026-06-01T12:00:00Z");

describe("isAccountActiveByLead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true quando a conta dona do lead tem acesso no futuro (AUTO)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({
      user: { billingOverride: "AUTO", accessUntil: FUTURE },
    });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-1")).toBe(true);
  });

  it("false quando o acesso venceu (AUTO + data passada)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({
      user: { billingOverride: "AUTO", accessUntil: PAST },
    });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-2")).toBe(false);
  });

  it("false (fail-safe) quando o lead não existe", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue(null);
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("nao-existe")).toBe(false);
  });
});

describe("setAccountAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa suspender (override SUSPENDED) uma conta admin", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u-admin", email: "admin@exemplo.com" });
    const { setAccountAccess } = await import("./account.service");
    await expect(
      setAccountAccess("u-admin", { kind: "forceSuspend" }),
    ).rejects.toThrow(/admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("estende N dias e zera override p/ AUTO", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: null,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", { kind: "extend", days: 60 });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("AUTO");
    expect(arg.data.accessUntil).toBeInstanceOf(Date);
  });

  it("força ativo (override ACTIVE) sem mexer na data", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: PAST,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");
    await setAccountAccess("u-cli", { kind: "forceActive" });
    const arg = (prisma.user.update as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("ACTIVE");
    expect(arg.data).not.toHaveProperty("accessUntil");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: FAIL — `setAccountAccess` não existe / seleciona campos antigos.

**Step 3: Reescrever `account.service.ts`**

```typescript
// src/server/services/account.service.ts
import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { accountActive, daysRemaining, addDays, type BillingOverride } from "@/lib/billing";
import type { PaymentMethod } from "@prisma/client";

/**
 * True se a conta dona do lead está ativa (prazo no futuro OU forçada ativa).
 * Fail-safe: lead/conta inexistente → false (preferimos silenciar a IA).
 */
export async function isAccountActiveByLead(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { user: { select: { billingOverride: true, accessUntil: true } } },
  });
  if (!lead?.user) return false;
  return accountActive(lead.user);
}

/** True se a conta (por id do usuário logado) está ativa. Fail-safe: inexistente → false. */
export async function isAccountActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billingOverride: true, accessUntil: true },
  });
  if (!user) return false;
  return accountActive(user);
}

/** Linha de conta para o painel admin (Financeiro). */
export interface AdminAccountRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  billingOverride: BillingOverride;
  accessUntil: Date | null;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: Date | null;
  isAdmin: boolean;
  numbers: number;
  leads: number;
  createdAt: Date;
}

/** Lista todas as contas com status calculado, para o painel Financeiro. */
export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      billingOverride: true,
      accessUntil: true,
      paymentMethod: true,
      paymentDueDate: true,
      createdAt: true,
      _count: { select: { whatsAppNumbers: true, leads: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: accountActive(u),
    billingOverride: u.billingOverride as BillingOverride,
    accessUntil: u.accessUntil,
    daysLeft: daysRemaining(u.accessUntil),
    paymentMethod: u.paymentMethod,
    paymentDueDate: u.paymentDueDate,
    isAdmin: isAdminEmail(u.email),
    numbers: u._count.whatsAppNumbers,
    leads: u._count.leads,
    createdAt: u.createdAt,
  }));
}

/** Ação do admin sobre o prazo/override de uma conta. */
export type AccessAction =
  | { kind: "extend"; days: number }              // +N dias a partir de max(prazo, hoje); volta p/ AUTO
  | { kind: "setUntil"; date: Date }              // define a validade exata; volta p/ AUTO
  | { kind: "forceActive" }                       // libera ignorando a data
  | { kind: "forceSuspend" }                      // suspende ignorando a data
  | { kind: "auto" }                              // volta a seguir a data
  | {                                             // anotação: forma de pgto + vencimento (não afeta acesso)
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: Date | null;
    };

/**
 * Aplica uma ação de acesso. Trava: NUNCA suspende/expira uma conta admin
 * (forceSuspend bloqueado). Devolve `{ id }`.
 */
export async function setAccountAccess(
  userId: string,
  action: AccessAction,
): Promise<{ id: string }> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, accessUntil: true },
  });
  if (!target) throw new Error("Conta não encontrada.");

  const isAdmin = isAdminEmail(target.email);
  if (isAdmin && action.kind === "forceSuspend") {
    throw new Error("Não é possível suspender uma conta admin.");
  }

  let data: {
    billingOverride?: BillingOverride;
    accessUntil?: Date;
    paymentMethod?: PaymentMethod | null;
    paymentDueDate?: Date | null;
  };
  switch (action.kind) {
    case "extend":
      data = { billingOverride: "AUTO", accessUntil: addDays(target.accessUntil, action.days) };
      break;
    case "setUntil":
      data = { billingOverride: "AUTO", accessUntil: action.date };
      break;
    case "forceActive":
      data = { billingOverride: "ACTIVE" };
      break;
    case "forceSuspend":
      data = { billingOverride: "SUSPENDED" };
      break;
    case "auto":
      data = { billingOverride: "AUTO" };
      break;
    case "setInfo":
      // Só anotação: não toca em billingOverride/accessUntil (acesso intacto).
      data = { paymentMethod: action.paymentMethod, paymentDueDate: action.paymentDueDate };
      break;
  }

  await prisma.user.update({ where: { id: userId }, data, select: { id: true } });
  return { id: userId };
}
```

> **Removida** a antiga `setAccountBilling`. A rota da API (Phase 4) passa a usar `setAccountAccess`.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/account.service.ts src/server/services/account.service.test.ts
git commit -m "feat(financeiro): account.service por prazo+override (setAccountAccess)"
```

### Task 2.2: Dispatcher — filtro de claim por override+data

**Files:**
- Modify: `src/server/worker/dispatcher.ts` (`claimNextJobForAccount` ~linha 119, `processNextJob` ~linha 165)

**Step 1: Criar um helper de `where` reutilizável** no topo do arquivo (após os imports):

```typescript
import type { Prisma } from "@prisma/client";

/**
 * Filtro Prisma "conta ativa AGORA" (espelha accountActive): override ACTIVE,
 * OU AUTO com accessUntil no futuro. SUSPENDED cai fora naturalmente.
 */
function activeAccountWhere(now: Date): Prisma.UserWhereInput {
  return {
    OR: [
      { billingOverride: "ACTIVE" },
      { billingOverride: "AUTO", accessUntil: { gt: now } },
    ],
  };
}
```

**Step 2: `claimNextJobForAccount`** — trocar a linha 119:

```typescript
      lead: { is: { userId, user: { is: { billingActive: true } } } },
```

por:

```typescript
      // conta suspensa/vencida não dispara (job fica PENDING, flui ao reativar)
      lead: { is: { userId, user: { is: activeAccountWhere(now) } } },
```

**Step 3: `processNextJob`** — trocar a linha 165:

```typescript
      lead: { is: { user: { is: { billingActive: true } } } },
```

por:

```typescript
      lead: { is: { user: { is: activeAccountWhere(now) } } },
```

**Step 4: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (a relação `user.accessUntil`/`billingOverride` existe no client regenerado na Task 1.1).

**Step 5: Commit**

```bash
git add src/server/worker/dispatcher.ts
git commit -m "feat(financeiro): outbound filtra por prazo+override (helper activeAccountWhere)"
```

---

## Phase 3 — Cadastro novo ganha trial automático (env)

### Task 3.1: `TRIAL_DAYS` no env validado

**Files:**
- Modify: `src/lib/env.ts` (onde as env vars são lidas/validadas — confira o arquivo)
- Modify: `.env` (local) e Railway web depois

**Step 1:** Localizar o schema de env (provável `src/lib/env.ts`). Adicionar `TRIAL_DAYS` como número com default `7`:

```typescript
  // Dias de teste grátis para cadastros novos. 0 = nasce suspenso (sem trial).
  TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(7),
```

> Se o projeto não usa `zod` para env (confira o padrão real do arquivo), siga o MESMO estilo já presente. O importante: `TRIAL_DAYS` numérico com default 7, lido server-side.

**Step 2: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(financeiro): env TRIAL_DAYS (default 7)"
```

### Task 3.2: `registerUser` grava o trial

**Files:**
- Modify: `src/server/services/user.service.ts` (`registerUser`, ~linha 38-49)
- Modify: `src/server/services/user.service.register.test.ts`

**Step 1: Reescrever o teste** (substituir o caso antigo):

```typescript
// src/server/services/user.service.register.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/email", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { TRIAL_DAYS: 7 } }));

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("cria conta NOVA com trial de 7 dias (AUTO + accessUntil futuro)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: "u-1", sessionEpoch: 0 });
    const { registerUser } = await import("./user.service");
    await registerUser({ name: "Cliente", email: "c@x.com", password: "12345678" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.billingOverride).toBe("AUTO");
    expect(arg.data.accessUntil).toEqual(new Date("2026-07-04T12:00:00Z"));
  });
});
```

> Se `TRIAL_DAYS=0`, `accessUntil` deve sair `null` (nasce suspenso). Pode adicionar um 2º caso com `vi.mock("@/lib/env", () => ({ env: { TRIAL_DAYS: 0 } }))` em um arquivo separado, ou cobrir via smoke (Phase 6).

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/user.service.register.test.ts`
Expected: FAIL.

**Step 3: Implementar** em `registerUser` — trocar o bloco do `create` (remover `billingActive: false`, calcular trial):

```typescript
  const trialDays = env.TRIAL_DAYS;
  const accessUntil =
    trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      whatsapp: input.whatsapp?.trim() || null,
      passwordHash: hashPassword(input.password),
      // Trial automático: nasce AUTO com prazo. TRIAL_DAYS=0 → accessUntil=null
      // (nasce suspenso, comportamento antigo). Admin estende no /financeiro.
      billingOverride: "AUTO",
      accessUntil,
    },
    select: { id: true, sessionEpoch: true },
  });
```

Adicionar o import no topo (se ainda não houver): `import { env } from "@/lib/env";`

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/user.service.register.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/user.service.ts src/server/services/user.service.register.test.ts
git commit -m "feat(financeiro): cadastro novo nasce com trial (accessUntil via TRIAL_DAYS)"
```

> **Mudança de produto:** antes o cadastro nascia mudo até liberação. Agora nasce com trial de N dias (default 7) e expira sozinho. Para voltar ao comportamento antigo, basta `TRIAL_DAYS=0`.

---

## Phase 4 — API admin: ações de acesso

### Task 4.1: Rota aceita as ações (extend/setUntil/forceActive/forceSuspend/auto)

**Files:**
- Modify: `src/app/api/admin/accounts/[id]/billing/route.ts`

**Step 1: Reescrever a rota** para o novo payload:

```typescript
// src/app/api/admin/accounts/[id]/billing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { setAccountAccess, type AccessAction } from "@/server/services/account.service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extend"), days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal("setUntil"), date: z.string().datetime() }),
  z.object({ kind: z.literal("forceActive") }),
  z.object({ kind: z.literal("forceSuspend") }),
  z.object({ kind: z.literal("auto") }),
  z.object({
    kind: z.literal("setInfo"),
    paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "TRANSFERENCIA"]).nullable(),
    paymentDueDate: z.string().datetime().nullable(),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;
  if (!me || !isAdminEmail(me.email)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  let action: AccessAction;
  if (parsed.data.kind === "setUntil") {
    action = { kind: "setUntil", date: new Date(parsed.data.date) };
  } else if (parsed.data.kind === "setInfo") {
    action = {
      kind: "setInfo",
      paymentMethod: parsed.data.paymentMethod,
      paymentDueDate: parsed.data.paymentDueDate ? new Date(parsed.data.paymentDueDate) : null,
    };
  } else {
    action = parsed.data as AccessAction;
  }

  const { id } = await params;
  try {
    await setAccountAccess(id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar." },
      { status: 400 },
    );
  }
}
```

**Step 2: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add "src/app/api/admin/accounts/[id]/billing/route.ts"
git commit -m "feat(financeiro): API de ações de acesso (extend/setUntil/force/auto/setInfo)"
```

---

## Phase 5 — UI: modal de gestão de prazo

### Task 5.1: Componente client — modal de acesso

**Files:**
- Create: `src/components/app/AccountAccessModal.tsx`
- Delete: `src/components/app/AccountBillingToggle.tsx` (substituído)

**Step 1: Implementar o modal** (botão "Gerenciar" abre painel com as ações). Reusar o componente de modal do repo se houver (procure `Modal`/`Dialog` em `src/components/ui`); senão, um popover simples:

```typescript
// src/components/app/AccountAccessModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PaymentMethod = "PIX" | "CARTAO" | "BOLETO" | "TRANSFERENCIA";

type Action =
  | { kind: "extend"; days: number }
  | { kind: "forceActive" }
  | { kind: "forceSuspend" }
  | { kind: "auto" }
  | { kind: "setInfo"; paymentMethod: PaymentMethod | null; paymentDueDate: string | null };

const METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
};

/** Date | null -> "YYYY-MM-DD" para o <input type="date"> (ou ""). */
function toDateInput(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

export function AccountAccessModal({
  accountId,
  active,
  isAdmin,
  daysLeft,
  paymentMethod,
  paymentDueDate,
}: {
  accountId: string;
  active: boolean;
  isAdmin: boolean;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: string | null; // ISO string (serializado do server) ou null
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Estado local do formulário de anotação (forma de pgto + vencimento).
  const [method, setMethod] = useState<PaymentMethod | "">(paymentMethod ?? "");
  const [due, setDue] = useState<string>(toDateInput(paymentDueDate));

  async function send(action: Action) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao atualizar.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function saveInfo() {
    // "YYYY-MM-DD" -> ISO datetime (meio-dia UTC evita pular de dia por fuso).
    const dueIso = due ? new Date(`${due}T12:00:00.000Z`).toISOString() : null;
    return send({ kind: "setInfo", paymentMethod: method || null, paymentDueDate: dueIso });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
      >
        Gerenciar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-sm font-bold text-ink">Acesso da conta</p>
              <p className="text-xs text-slate-500">
                {active ? "Ativa" : "Suspensa"}
                {daysLeft != null && ` · ${daysLeft} dia(s) restante(s)`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => send({ kind: "extend", days: 7 })}
                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                +7 dias (trial)
              </button>
              <button disabled={busy} onClick={() => send({ kind: "extend", days: 30 })}
                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                +30 dias
              </button>
              <button disabled={busy} onClick={() => send({ kind: "extend", days: 60 })}
                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                +60 dias (2 mês)
              </button>
              <button disabled={busy} onClick={() => send({ kind: "auto" })}
                className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                Seguir prazo (auto)
              </button>
              <button disabled={busy} onClick={() => send({ kind: "forceActive" })}
                className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-40">
                Forçar ativo
              </button>
              <button disabled={busy || isAdmin} onClick={() => send({ kind: "forceSuspend" })}
                title={isAdmin ? "Conta admin não pode ser suspensa" : undefined}
                className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                Suspender
              </button>
            </div>

            {/* Anotação financeira: forma de pagamento + vencimento (não afeta o acesso) */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Pagamento (anotação)
              </p>
              <label className="block">
                <span className="text-xs text-slate-500">Forma de pagamento</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">— não informado —</option>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Vencimento da mensalidade</span>
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <button disabled={busy} onClick={saveInfo}
                className="w-full rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
                Salvar pagamento
              </button>
            </div>

            <button onClick={() => setOpen(false)}
              className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600">
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

> Confira se já existe um `Modal`/`Dialog` em `src/components/ui` e prefira reusar (DRY). Se sim, troque o overlay manual pelo componente do repo mantendo os mesmos botões.

**Step 2: Apagar o toggle antigo**

```bash
git rm src/components/app/AccountBillingToggle.tsx
```

**Step 3: Commit**

```bash
git add src/components/app/AccountAccessModal.tsx
git commit -m "feat(financeiro): modal de prazo + form de pagamento (substitui toggle)"
```

### Task 5.2: Página `/financeiro` mostra validade + dias e usa o modal

**Files:**
- Modify: `src/app/(app)/financeiro/page.tsx`

**Step 1:** Trocar o import e as colunas. Substituir `AccountBillingToggle` por `AccountAccessModal`; trocar a leitura de `a.billingActive` por `a.active`; adicionar coluna "Validade":

- Import (linha 10):
  ```typescript
  import { AccountAccessModal } from "@/components/app/AccountAccessModal";
  ```
- Cabeçalho da tabela — adicionar `<Th>Validade</Th>` e `<Th>Pagamento</Th>` antes de `<Th>Status</Th>`.
- Célula de validade (antes da de Status):
  ```tsx
  <Td className="whitespace-nowrap text-slate-500">
    {a.accessUntil ? formatDateTime(a.accessUntil) : "—"}
    {a.daysLeft != null && (
      <span className="ml-1 text-xs text-slate-400">({a.daysLeft}d)</span>
    )}
  </Td>
  ```
- Célula de pagamento (forma + vencimento — anotação):
  ```tsx
  <Td className="whitespace-nowrap text-slate-500">
    {a.paymentMethod
      ? ({ PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto", TRANSFERENCIA: "Transferência" }[a.paymentMethod])
      : "—"}
    {a.paymentDueDate && (
      <span className="ml-1 text-xs text-slate-400">
        vence {formatDateTime(a.paymentDueDate)}
      </span>
    )}
  </Td>
  ```
- Célula de Status:
  ```tsx
  <Td>
    <Badge tone={a.active ? "green" : "slate"}>
      {a.active ? "Ativo" : "Suspenso"}
    </Badge>
  </Td>
  ```
- Célula de Ação — passar também as props de pagamento ao modal. `paymentDueDate` é serializado como ISO string ao cruzar server→client; converta com `?.toISOString()`:
  ```tsx
  <Td>
    <AccountAccessModal
      accountId={a.id}
      active={a.active}
      isAdmin={a.isAdmin}
      daysLeft={a.daysLeft}
      paymentMethod={a.paymentMethod}
      paymentDueDate={a.paymentDueDate ? a.paymentDueDate.toISOString() : null}
    />
  </Td>
  ```
- Atualizar o texto descritivo (linha 45-48) para mencionar prazo/validade.

**Step 2: Conferir tipos + build**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add "src/app/(app)/financeiro/page.tsx"
git commit -m "feat(financeiro): página mostra validade/dias e usa modal de acesso"
```

---

## Phase 6 — Limpeza: remover `billingActive` + smoke

### Task 6.1: Atualizar o smoke para o novo modelo

**Files:**
- Modify: `scripts/smoke-financeiro.ts`

**Step 1:** Reescrever as checagens que liam `billingActive`/`setAccountBilling` para usar `accessUntil`/`billingOverride`/`setAccountAccess`. Cobrir:
- cadastro novo nasce com `accessUntil` futuro (trial) e `billingOverride=AUTO`;
- `isAccountActiveByLead` = true durante o trial;
- `setAccountAccess(forceSuspend)` → `isAccountActiveByLead` = false;
- `setAccountAccess(forceActive)` → true;
- `setAccountAccess(extend, 60)` → `accessUntil` ~60 dias à frente, `AUTO`;
- trava admin: `forceSuspend` numa conta admin lança erro.

Siga o estilo de `check(...)` já presente no arquivo.

**Step 2: Rodar o smoke** (precisa de `DATABASE_URL` de teste/dev):

Run: `npx tsx scripts/smoke-financeiro.ts`
Expected: todas as checagens ✅.

**Step 3: Commit**

```bash
git add scripts/smoke-financeiro.ts
git commit -m "test(financeiro): smoke do prazo de acesso (trial/extend/force/trava)"
```

### Task 6.2: Remover a coluna vestigial `billingActive`

> Só depois de confirmar que NADA mais lê `billingActive` (rode o grep abaixo). O backfill (Phase 1) já transferiu o estado para `billingOverride`.

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Confirmar que não há mais usos**

Run: `git grep -n "billingActive" -- "src" "scripts"`
Expected: **nenhuma** ocorrência (fora de docs). Se aparecer algo, corrija antes de seguir.

**Step 2: Remover a linha** `billingActive Boolean @default(true)` do `model User` em `prisma/schema.prisma`.

**Step 3: Aplicar e regerar**

Run: `npx prisma db push`
Expected: `Your database is now in sync` — a coluna é **dropada** (estado já migrado para `billingOverride`).

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

**Step 4: Conferir build**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "chore(financeiro): remove coluna vestigial billingActive"
```

---

## Phase 7 — Env + verificação manual

### Task 7.1: Definir `TRIAL_DAYS`

- **Local** (`.env`): `TRIAL_DAYS=7` (ou `3`). `0` = nasce suspenso (sem trial).
- **Produção (Railway):** serviço **web** (`sparkling-harmony`) → **Variables** → `TRIAL_DAYS=7`. O worker `crm-teste` **não precisa** (o gate de outbound lê `accessUntil`/`billingOverride` do banco, não do env).

### Task 7.2: Roteiro de verificação manual (dev)

Logado como admin (`matheusmoraesbrg@gmail.com`):

1. **Trial:** criar uma 2ª conta (cadastro normal) → em `/financeiro` ela aparece **Ativo**, com validade ~7 dias e `(7d)`. Inbound de teste → a IA **responde** (está no trial).
2. **Expiração por data:** no banco, setar `accessUntil` dessa conta para o passado (ou usar o modal → "Suspender") → novo inbound **não** é respondido; mensagem ainda é persistida.
3. **Forçar ativo:** modal → "Forçar ativo" → volta a responder mesmo com data vencida.
4. **Estender +60:** modal → "+60 dias (2 mês)" → validade salta ~60 dias, status volta a seguir o prazo (AUTO).
5. **Outbound:** com a conta vencida/suspensa, criar campanha/job → job fica `PENDING`, não dispara. Estender/forçar ativo → no próximo poll o job flui.
6. **Trava admin:** modal da sua conta → botão "Suspender" **desabilitado**; `POST` direto de `forceSuspend` no seu id → 400 com erro de admin.
7. **Anotação de pagamento:** no modal de uma conta, escolher "Pix" + uma data de vencimento → "Salvar pagamento" → a tabela passa a mostrar "Pix · vence DD/MM". Reabrir o modal → os valores vêm preenchidos. Confirmar que **não** mudou o status de acesso (continua Ativo/Suspenso como estava).

### Task 7.3: Suite completa + build

Run: `npx vitest run`
Expected: todos os testes PASS.

Run: `npx tsc --noEmit` e `npm run build`
Expected: sem erros.

---

## Resumo das mudanças (checklist)

| Camada | Arquivo | Mudança |
|---|---|---|
| Helper puro | `src/lib/billing.ts` (novo) | `accountActive`, `daysRemaining`, `addDays` |
| Schema | `prisma/schema.prisma` | + `accessUntil`, + enum `billingOverride`, + enum `paymentMethod` + `paymentDueDate`; remove `billingActive` (Phase 6) |
| Backfill | `scripts/backfill-billing-override.ts` (novo) | `true→ACTIVE`, `false→SUSPENDED` |
| Serviço | `src/server/services/account.service.ts` | reads por `accountActive`; `setAccountAccess` (inclui `setInfo`) |
| Gate outbound | `src/server/worker/dispatcher.ts` | `activeAccountWhere(now)` nos dois claims |
| Cadastro | `src/server/services/user.service.ts` | trial via `TRIAL_DAYS` (accessUntil) |
| Env | `src/lib/env.ts` + `.env` + Railway web | `TRIAL_DAYS` (default 7) |
| API | `src/app/api/admin/accounts/[id]/billing/route.ts` | ações extend/setUntil/force/auto/setInfo |
| UI | `src/components/app/AccountAccessModal.tsx` (novo) | modal de prazo + form de pagamento (substitui toggle) |
| UI | `src/app/(app)/financeiro/page.tsx` | colunas Validade + Pagamento + modal |
| Smoke | `scripts/smoke-financeiro.ts` | novo modelo |

## Pontos de atenção / decisões já tomadas

- **Suspensão por data em tempo real** (confirmado) — sem cron; os gates comparam `accessUntil > now` na hora.
- **Modelo híbrido** (confirmado) — `billingOverride` (AUTO/ACTIVE/SUSPENDED) ganha da data nos dois sentidos.
- **Trial automático no cadastro** (mudança de produto) — antes nascia suspenso; agora nasce com `TRIAL_DAYS` (default 7). `TRIAL_DAYS=0` restaura o comportamento antigo.
- **Migração não-destrutiva** — `billingActive` preservado até o backfill; contas ativas viram `ACTIVE` (funcionam sem data), só removida na Phase 6.
- **Trava admin** — `forceSuspend` bloqueado para contas admin; reativação não responde retroativo (gate só vale p/ msgs novas).
- **Gates externos intactos** — `conversation.service`, `campaigns` route e o gate de inbound não mudam (centralização nas duas funções do service).
- **Forma de pagamento + vencimento são ANOTAÇÃO** (confirmado) — lista fixa (Pix/Cartão/Boleto/Transferência) + data de vencimento separada, editáveis no modal. **Não afetam o acesso** (quem controla acesso é `accessUntil`/`billingOverride`); servem só pro seu registro/lembrete. Sem gateway de cobrança real — se um dia quiser cobrança automática, é outro projeto.
