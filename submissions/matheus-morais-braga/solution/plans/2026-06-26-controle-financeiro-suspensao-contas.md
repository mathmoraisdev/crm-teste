# Controle Financeiro — Suspensão de Contas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Dar ao admin (você) uma aba "Financeiro" no sidebar para ativar/suspender contas por pagamento; conta suspensa = a IA não responde inbound **e** o disparo outbound congela, voltando a fluir só quando você reativar.

**Architecture:**
- Uma única coluna nova: `User.billingActive Boolean @default(true)`. Contas existentes nascem ativas (default preserva tudo); cadastros novos (self-registration) gravam `false` explícito (suspenso até você liberar).
- "Admin" reaproveita o conceito que **já existe**: e-mail ∈ `ADMIN_EMAILS` (env, separados por vírgula). Nenhuma coluna `isAdmin`, nenhum bootstrap.
- Dois "gates" lêem `billingActive`: o inbound (`ingestInbound` devolve `respond:false`, mas **persiste** a mensagem) e o outbound (filtro nas queries de claim de job). Custo de IA não muda: BYOK com fallback pra plataforma já é o comportamento atual (`resolve.ts`).

**Tech Stack:** Next.js (App Router, server components), Prisma + PostgreSQL, Baileys worker, Vitest (`vi.mock` do prisma), TypeScript.

---

## Convenções deste repositório (leia antes de começar)

- **Migrations:** o projeto usa `npx prisma db push` (não `migrate dev`) — ver comentário no topo de [prisma/schema.prisma](../../prisma/schema.prisma). Como a coluna nova tem `@default(true)`, o push é **aditivo e não-destrutivo** (linhas existentes recebem `true`).
- **Testes:** Vitest com alias `@/` ([vitest.config.ts](../../vitest.config.ts)). Padrão = `vi.mock("@/server/db/client", () => ({ prisma: { ... } }))`. Modelo em [src/server/ai/resolve.test.ts](../../src/server/ai/resolve.test.ts).
- **Rodar um teste:** `npx vitest run <caminho> -t "<nome>"`.
- **Admin idiom (já em uso):** [src/app/(app)/consultores/page.tsx:14-25](../../src/app/(app)/consultores/page.tsx#L14-L25) compara `user.email.toLowerCase()` contra `env.ADMIN_EMAILS`. Vamos **extrair** isso para um helper compartilhado (DRY).
- **Commits:** frequentes, um por tarefa. Mensagem em pt-BR seguindo o estilo do repo (`feat(financeiro): ...`).

---

## Phase 0 — Schema: coluna `billingActive`

### Task 0.1: Adicionar a coluna no schema

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, perto da linha 29)

**Step 1: Editar o model User**

No bloco `model User`, logo após a linha `sessionEpoch Int @default(0) ...`, adicione:

```prisma
  // Billing: conta ativa = IA responde e disparo flui. Suspensa (inadimplência)
  // = IA silencia (só persiste o inbound) e outbound congela. Cadastros novos
  // nascem `false` (controle do admin); contas existentes migram para `true`.
  billingActive Boolean   @default(true)
```

**Step 2: Aplicar no banco**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema`. Nenhuma perda de dado; todas as contas existentes ficam com `billingActive = true`.

**Step 3: Regerar o client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(financeiro): coluna billingActive no User (default ativo)"
```

---

## Phase 1 — Helpers puros (admin + status de conta)

Construímos as peças testáveis isoladas ANTES de fiar nos gates/UI.

### Task 1.1: Helper de admin compartilhado

**Files:**
- Create: `src/lib/admin.ts`
- Test: `src/lib/admin.test.ts`

**Step 1: Escrever o teste que falha**

```typescript
// src/lib/admin.test.ts
import { describe, it, expect, beforeEach } from "vitest";

describe("isAdminEmail", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "matheusmoraesbrg@gmail.com, Outro@Exemplo.com";
  });

  it("reconhece e-mail admin ignorando caixa e espaços", async () => {
    const { isAdminEmail } = await import("./admin");
    expect(isAdminEmail("MatheusMoraesBRG@gmail.com")).toBe(true);
    expect(isAdminEmail("outro@exemplo.com")).toBe(true);
  });

  it("nega e-mail fora da lista e valores vazios", async () => {
    const { isAdminEmail } = await import("./admin");
    expect(isAdminEmail("aleatorio@cliente.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: FAIL — `Cannot find module './admin'`.

**Step 3: Implementar o mínimo**

```typescript
// src/lib/admin.ts
import { env } from "@/lib/env";

/** Conjunto de e-mails admin do env (`ADMIN_EMAILS`), normalizados. */
export function adminEmailSet(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True se o e-mail pertence à lista de administradores. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email.trim().toLowerCase());
}
```

> Nota: `env` lê `process.env` no import. Como o teste seta `ADMIN_EMAILS` em `beforeEach` e o `import` é dinâmico dentro do teste, o valor é lido na primeira importação. Se algum teste precisar de valores diferentes por caso, use `vi.resetModules()` entre eles. Para este conjunto basta um valor estável.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: PASS (2 testes).

**Step 5: Commit**

```bash
git add src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat(financeiro): helper isAdminEmail (ADMIN_EMAILS)"
```

### Task 1.2: Refatorar consultores p/ usar o helper (DRY)

**Files:**
- Modify: `src/app/(app)/consultores/page.tsx:13-25`

**Step 1:** Remover a função local `adminEmails()` e a montagem inline; importar o helper.

Trocar o topo do arquivo:

```typescript
import { isAdminEmail } from "@/lib/admin";
// ...remover `import { env } ...` se não for mais usado neste arquivo
```

E dentro do componente, trocar:

```typescript
const isAdmin = !!user && adminEmailSet().has(user.email.toLowerCase());
```

por:

```typescript
const isAdmin = isAdminEmail(user?.email);
```

Apagar a função `adminEmails()` local (linhas 13-20).

**Step 2: Verificar build de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a este arquivo.

**Step 3: Commit**

```bash
git add src/app/(app)/consultores/page.tsx
git commit -m "refactor(financeiro): consultores reusa isAdminEmail"
```

### Task 1.3: `account.service` — status e listagem para o admin

**Files:**
- Create: `src/server/services/account.service.ts`
- Test: `src/server/services/account.service.test.ts`

**Step 1: Escrever os testes que falham**

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

describe("isAccountActiveByLead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true quando a conta dona do lead está ativa", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({ user: { billingActive: true } });
    const { isAccountActiveByLead } = await import("./account.service");
    expect(await isAccountActiveByLead("lead-1")).toBe(true);
  });

  it("false quando a conta está suspensa", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findUnique as any).mockResolvedValue({ user: { billingActive: false } });
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

describe("setAccountBilling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa suspender uma conta admin", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-admin",
      email: "admin@exemplo.com",
    });
    const { setAccountBilling } = await import("./account.service");
    await expect(setAccountBilling("u-admin", false)).rejects.toThrow(/admin/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("ativa/suspende uma conta comum", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli", billingActive: false });
    const { setAccountBilling } = await import("./account.service");
    await setAccountBilling("u-cli", false);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-cli" },
      data: { billingActive: false },
      select: { id: true, billingActive: true },
    });
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```typescript
// src/server/services/account.service.ts
import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";

/**
 * True se a conta dona do lead está ativa (pagamento em dia). Fail-safe: se o
 * lead/conta não for encontrado, devolve `false` — preferimos silenciar a IA a
 * responder em nome de uma conta indefinida.
 */
export async function isAccountActiveByLead(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { user: { select: { billingActive: true } } },
  });
  return lead?.user?.billingActive === true;
}

/** Linha de conta para o painel admin (Financeiro). */
export interface AdminAccountRow {
  id: string;
  name: string;
  email: string;
  billingActive: boolean;
  isAdmin: boolean;
  numbers: number;
  leads: number;
  createdAt: Date;
}

/** Lista todas as contas com contadores, para o painel Financeiro. */
export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      billingActive: true,
      createdAt: true,
      _count: { select: { whatsAppNumbers: true, leads: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    billingActive: u.billingActive,
    isAdmin: isAdminEmail(u.email),
    numbers: u._count.whatsAppNumbers,
    leads: u._count.leads,
    createdAt: u.createdAt,
  }));
}

/**
 * Ativa/suspende uma conta. Trava de segurança: NUNCA suspende uma conta admin
 * (evita o operador se cortar por engano). Devolve o novo estado.
 */
export async function setAccountBilling(
  userId: string,
  active: boolean,
): Promise<{ id: string; billingActive: boolean }> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) throw new Error("Conta não encontrada.");
  if (!active && isAdminEmail(target.email)) {
    throw new Error("Não é possível suspender uma conta admin.");
  }
  return prisma.user.update({
    where: { id: userId },
    data: { billingActive: active },
    select: { id: true, billingActive: true },
  });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: PASS (5 testes).

**Step 5: Commit**

```bash
git add src/server/services/account.service.ts src/server/services/account.service.test.ts
git commit -m "feat(financeiro): account.service (status por lead, listagem e toggle com trava admin)"
```

---

## Phase 2 — Gate de INBOUND (a IA cala quando suspenso)

### Task 2.1: `ingestInbound` devolve `respond:false` para conta suspensa

**Files:**
- Modify: `src/server/services/conversation.service.ts` (dentro de `ingestInbound`, após o bloco de opt-out, ~linha 184)
- Test: `src/server/services/account.service.test.ts` já cobre o helper; o gate em si é verificado por inspeção + smoke (Phase 7). Opcional: teste de integração abaixo.

**Step 1: Implementar o gate**

Em `ingestInbound`, **depois** do bloco `if (isOptOut(...))` (linha ~184, o opt-out tem precedência legal e deve continuar funcionando mesmo suspenso) e **antes** do cálculo de timing/`return ... respond: true` (linha ~199), inserir:

```typescript
  // Gate de billing: conta suspensa (inadimplência) → a IA silencia. O inbound
  // JÁ foi persistido acima (operador continua vendo o que chegou); só não
  // geramos resposta automática. Reativar volta a responder mensagens NOVAS,
  // sem responder retroativamente o acúmulo.
  if (!(await isAccountActiveByLead(lead.id))) {
    return { leadId: lead.id, respond: false, delayMs: 0 };
  }
```

Adicionar o import no topo do arquivo:

```typescript
import { isAccountActiveByLead } from "@/server/services/account.service";
```

> **Por que aqui:** dedupe → resolve/cria lead → persiste Message(INBOUND) → opt-out (legal, sempre) → **gate de billing** → respond. Assim a mensagem do cliente nunca se perde; apenas a resposta da IA é suprimida.

**Step 2: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

**Step 3: (Opcional) Teste de integração do gate**

Se quiser blindar com teste, criar `src/server/services/ingest-billing.test.ts` mockando `@/server/db/client` (com `message.create`, `message.findUnique`, `lead.findUnique`, `whatsAppNumber.findUnique`) e o `account.service`, afirmando que um lead de conta suspensa retorna `{ respond: false }`. Caso o setup fique pesado, pule — o helper já é testado e o gate é uma linha.

**Step 4: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(financeiro): IA silencia inbound de conta suspensa (persiste msg)"
```

---

## Phase 3 — Gate de OUTBOUND (disparo congela quando suspenso)

O disparo passa por DUAS funções de claim em [src/server/worker/dispatcher.ts](../../src/server/worker/dispatcher.ts): `claimNextJobForAccount` (modo Baileys, usado em produção) e `processNextJob` (modo mock/cloud-api). Gatear nas duas garante cobertura.

### Task 3.1: Filtrar jobs de contas suspensas no claim

**Files:**
- Modify: `src/server/worker/dispatcher.ts` (`claimNextJobForAccount` ~linha 113 e `processNextJob` ~linha 157)

**Step 1: `claimNextJobForAccount`** — no `where` do `findFirst`, trocar o filtro de lead:

```typescript
      lead: { is: { userId } },
```

por:

```typescript
      // billingActive: conta suspensa não dispara (job fica PENDING, volta a
      // fluir sozinho ao reativar).
      lead: { is: { userId, user: { is: { billingActive: true } } } },
```

**Step 2: `processNextJob`** — no `where` do `findFirst` (linha ~158), adicionar o filtro de conta ativa como chave irmã do `status` (AND implícito):

```typescript
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      lead: { is: { user: { is: { billingActive: true } } } },
      OR: [
        { campaignId: null },
        {
          campaign: { status: { not: "PAUSED" } },
          ...(capped.length > 0 ? { campaignId: { notIn: capped } } : {}),
        },
      ],
    },
```

**Step 3: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (a relação `lead.user.billingActive` existe no client regenerado na Task 0.3).

**Step 4: Commit**

```bash
git add src/server/worker/dispatcher.ts
git commit -m "feat(financeiro): outbound congela para contas suspensas (filtro no claim)"
```

> **Nota de comportamento:** o job permanece `PENDING` (não é cancelado nem falha). Ao reativar a conta, o worker volta a capturá-lo no próximo poll. Sem migração de dados, sem perda.

---

## Phase 4 — API admin: toggle de billing

### Task 4.1: Rota protegida de toggle

**Files:**
- Create: `src/app/api/admin/accounts/[id]/billing/route.ts`
- Helper (opcional): `src/lib/session.ts` já expõe `getCurrentUserId`; usamos `getUserById` + `isAdminEmail` para a guarda.

**Step 1: Implementar a rota**

```typescript
// src/app/api/admin/accounts/[id]/billing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { setAccountBilling } from "@/server/services/account.service";

export const runtime = "nodejs";

const schema = z.object({ active: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Guarda de admin (server-side — não confiar no front).
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

  const { id } = await params;
  try {
    const updated = await setAccountBilling(id, parsed.data.active);
    return NextResponse.json({ ok: true, billingActive: updated.billingActive });
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
Expected: sem erros. (Confirme a assinatura de `params` conforme a versão do Next no repo — App Router recente usa `Promise<{id}>`; veja uma rota dinâmica existente como [src/app/api/numbers/[id]/route.ts](../../src/app/api/numbers/[id]/route.ts) e siga o MESMO formato.)

**Step 3: Commit**

```bash
git add "src/app/api/admin/accounts/[id]/billing/route.ts"
git commit -m "feat(financeiro): rota admin POST billing (toggle ativo/suspenso)"
```

---

## Phase 5 — UI: aba Financeiro + Sidebar

### Task 5.1: Passar `isAdmin` para o Sidebar

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/app/Sidebar.tsx`

**Step 1: Layout (server component) calcula e injeta `isAdmin`**

```typescript
// src/app/(app)/layout.tsx
import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  const user = userId ? await getUserById(userId) : null;
  const isAdmin = isAdminEmail(user?.email);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar isAdmin={isAdmin} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Sidebar aceita a prop e mostra o item só p/ admin**

Em `src/components/app/Sidebar.tsx`:

```typescript
import { Users, Send, Building2, CalendarClock, Smartphone, Settings, LogOut, Wallet } from "lucide-react";
```

Trocar a assinatura e o array `NAV` por uma versão que recebe `isAdmin`:

```typescript
const BASE_NAV = [
  { href: "/leads", label: "Conversas", icon: Users },
  { href: "/campaigns", label: "Campanhas", icon: Send },
  { href: "/agenda", label: "Agenda", icon: CalendarClock },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  // ...usePathname/useRouter/logout iguais...
  const nav = isAdmin
    ? [...BASE_NAV, { href: "/financeiro", label: "Financeiro", icon: Wallet }]
    : BASE_NAV;
```

E no `.map`, trocar `NAV.map(...)` por `nav.map(...)`.

**Step 3: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/app/(app)/layout.tsx src/components/app/Sidebar.tsx
git commit -m "feat(financeiro): item Financeiro no sidebar (somente admin)"
```

### Task 5.2: Página `/financeiro` (guarda + lista + toggle)

**Files:**
- Create: `src/app/(app)/financeiro/page.tsx` (server component: guarda + dados)
- Create: `src/components/app/AccountBillingToggle.tsx` (client component: botão que chama a API)

**Step 1: Componente client do toggle**

```typescript
// src/components/app/AccountBillingToggle.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountBillingToggle({
  accountId,
  active,
  disabled,
}: {
  accountId: string;
  active: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao atualizar.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || disabled}
      className={
        "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 " +
        (active
          ? "bg-red-50 text-red-600 hover:bg-red-100"
          : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")
      }
      title={disabled ? "Conta admin — não pode ser suspensa" : undefined}
    >
      {active ? "Suspender" : "Ativar"}
    </button>
  );
}
```

**Step 2: Página server-side**

```typescript
// src/app/(app)/financeiro/page.tsx
import { Lock } from "lucide-react";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { listAccountsForAdmin } from "@/server/services/account.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/utils";
import { AccountBillingToggle } from "@/components/app/AccountBillingToggle";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;

  if (!isAdminEmail(me?.email)) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Financeiro
        </h1>
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={20} />
          </span>
          <p className="text-sm font-bold text-ink">Acesso restrito</p>
          <p className="max-w-sm text-sm text-slate-500">
            Esta área é exclusiva do administrador.
          </p>
        </Card>
      </div>
    );
  }

  const accounts = await listAccountsForAdmin();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Ative ou suspenda contas conforme o pagamento. Conta suspensa: a IA não
          responde e o disparo congela até a reativação.
        </p>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Conta</Th>
              <Th>Chips</Th>
              <Th>Leads</Th>
              <Th>Criada</Th>
              <Th>Status</Th>
              <Th>Ação</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td>
                  <div className="font-semibold text-ink">
                    {a.name}
                    {a.isAdmin && (
                      <Badge tone="blue" className="ml-2">admin</Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{a.email}</div>
                </Td>
                <Td className="text-slate-600">{a.numbers}</Td>
                <Td className="text-slate-600">{a.leads}</Td>
                <Td className="whitespace-nowrap text-slate-500">
                  {formatDateTime(a.createdAt)}
                </Td>
                <Td>
                  <Badge tone={a.billingActive ? "green" : "slate"}>
                    {a.billingActive ? "Ativo" : "Suspenso"}
                  </Badge>
                </Td>
                <Td>
                  <AccountBillingToggle
                    accountId={a.id}
                    active={a.billingActive}
                    disabled={a.isAdmin}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
```

> Confira os props reais de `Card`/`Badge`/`Table`/`Th`/`Td` e a assinatura de `formatDateTime` (use os mesmos imports da página de consultores, que já compila). Se `Badge` não aceitar `className`, remova-o ou ajuste conforme o componente.

**Step 3: Conferir tipos + build**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add "src/app/(app)/financeiro/page.tsx" src/components/app/AccountBillingToggle.tsx
git commit -m "feat(financeiro): pagina /financeiro (lista de contas + toggle)"
```

---

## Phase 6 — Cadastros novos nascem suspensos

### Task 6.1: `registerUser` grava `billingActive: false`

**Files:**
- Modify: `src/server/services/user.service.ts` (`registerUser`, ~linha 38)
- Test: `src/server/services/user.service.register.test.ts` (novo, focado)

**Step 1: Escrever o teste que falha**

```typescript
// src/server/services/user.service.register.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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

describe("registerUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria conta NOVA já suspensa (billingActive=false)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: "u-1", sessionEpoch: 0 });
    const { registerUser } = await import("./user.service");
    await registerUser({ name: "Cliente", email: "c@x.com", password: "12345678" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.billingActive).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/user.service.register.test.ts`
Expected: FAIL — `billingActive` é `undefined` (default `true` no banco).

**Step 3: Implementar**

Em `registerUser`, no `prisma.user.create({ data: { ... } })`, adicionar a chave:

```typescript
      passwordHash: hashPassword(input.password),
      // Self-registration nasce SUSPENSA: o admin libera no painel Financeiro
      // (protege a chave de IA da plataforma e dá controle de inadimplência).
      billingActive: false,
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/user.service.register.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/user.service.ts src/server/services/user.service.register.test.ts
git commit -m "feat(financeiro): cadastro novo nasce suspenso (controle do admin)"
```

> **Atenção de produto:** após este passo, qualquer conta criada via tela de cadastro fica **muda** até você ativar em `/financeiro`. Isso é intencional (foi a decisão tomada). Sua conta `matheusmoraesbrg@gmail.com` já existe e está `true`, então não é afetada.

---

## Phase 7 — Configuração de ambiente + verificação manual

### Task 7.1: Definir `ADMIN_EMAILS`

**Onde:**
- **Local:** no arquivo `.env` (já aberto no seu editor):
  ```
  ADMIN_EMAILS=matheusmoraesbrg@gmail.com
  ```
- **Produção (Railway):** serviço **web** (`sparkling-harmony`) → aba **Variables** → adicionar/editar `ADMIN_EMAILS=matheusmoraesbrg@gmail.com`. (O worker `crm-teste` não precisa — o gate de outbound lê `billingActive` do banco, não de `ADMIN_EMAILS`.)

> Não toca em nenhuma config da sua conta — é só leitura de e-mail para liberar a aba.

### Task 7.2: Roteiro de verificação manual (dev)

Rodar o app (`npm run dev` ou o script do projeto) logado como `matheusmoraesbrg@gmail.com`:

1. **Aba aparece:** o item "Financeiro" surge no sidebar; logado como conta não-admin, não surge e `/financeiro` mostra "Acesso restrito".
2. **Lista:** `/financeiro` lista as contas com chips/leads e status. Sua conta aparece com badge "admin" e o botão "Suspender" **desabilitado**.
3. **Suspender uma conta de teste:** criar uma 2ª conta (cadastro normal) → ela nasce "Suspenso". Conectar um número e mandar um inbound de teste → a IA **não responde**, mas a mensagem aparece na conversa (foi persistida).
4. **Ativar:** clicar "Ativar" → status vira "Ativo" → novo inbound passa a ser respondido. Mensagens antigas (durante a suspensão) **não** são respondidas retroativamente.
5. **Outbound:** com a conta de teste suspensa, criar uma campanha/job → o job fica `PENDING` e não dispara. Ativar → no próximo poll do worker o job flui.
6. **Trava admin:** tentar `POST /api/admin/accounts/<seu-id>/billing {active:false}` → resposta 403/400 com erro "não é possível suspender uma conta admin".

### Task 7.3: Suite completa + build

Run: `npx vitest run`
Expected: todos os testes (novos + existentes) PASS.

Run: `npx tsc --noEmit` e o build do projeto (`npm run build`)
Expected: sem erros.

**Commit final (se algo de ajuste sobrou):**

```bash
git add -A
git commit -m "chore(financeiro): ajustes finais e verificação"
```

---

## Resumo das mudanças (checklist)

| Camada | Arquivo | Mudança |
|---|---|---|
| Schema | `prisma/schema.prisma` | `User.billingActive Boolean @default(true)` |
| Helper | `src/lib/admin.ts` (novo) | `isAdminEmail` / `adminEmailSet` |
| Helper | `src/app/(app)/consultores/page.tsx` | reusa `isAdminEmail` (DRY) |
| Serviço | `src/server/services/account.service.ts` (novo) | status por lead, listagem, toggle c/ trava admin |
| Gate inbound | `src/server/services/conversation.service.ts` | `respond:false` se conta suspensa (persiste msg) |
| Gate outbound | `src/server/worker/dispatcher.ts` | filtro `billingActive` em ambos os claims |
| API | `src/app/api/admin/accounts/[id]/billing/route.ts` (novo) | toggle protegido por admin |
| UI | `src/app/(app)/layout.tsx` + `Sidebar.tsx` | item Financeiro p/ admin |
| UI | `src/app/(app)/financeiro/page.tsx` + `AccountBillingToggle.tsx` (novos) | lista + toggle |
| Cadastro | `src/server/services/user.service.ts` | novos nascem `billingActive:false` |
| Env | `.env` + Railway web | `ADMIN_EMAILS=matheusmoraesbrg@gmail.com` |

## Pontos de atenção / decisões já tomadas

- **Default suspenso** para cadastros novos (confirmado). Contas existentes preservadas (`@default(true)`).
- **Reativação não responde retroativo** (confirmado) — só mensagens novas.
- **Custo de IA externo:** sem mudança de código — BYOK com fallback pra plataforma já existe (`resolve.ts`); cliente sem chave usa a sua e você cobra.
- **Suspensão = silêncio** (confirmado) — nenhum aviso ao cliente final.
- **Trava de auto-suspensão do admin** embutida no serviço e na API.
- **Opt-out (LGPD) tem precedência** sobre o gate de billing — continua funcionando mesmo com a conta suspensa.
</content>
</invoke>
