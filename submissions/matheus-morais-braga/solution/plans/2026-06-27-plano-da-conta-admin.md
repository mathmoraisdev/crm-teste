# Plano da Conta (rótulo definido pelo admin) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que o admin atribua um plano (Inicial / Profissional / Escala) a cada conta, visível na lista do Financeiro e editável no modal de acesso. É **rótulo**, não régua — não altera limites nem libera/bloqueia features (isso fica para um projeto separado de entitlements).

**Architecture:** Adiciona um enum `Plan` e o campo opcional `User.plan` no schema Prisma. O plano entra na união de ações existente `AccessAction` (`setPlan`), reaproveitando o caminho admin já consolidado: `POST /api/admin/accounts/[id]/billing` → `setAccountAccess` → `prisma.user.update`. A UI ganha uma seção "Plano" no `AccountAccessModal` e uma coluna na tabela do Financeiro. Conta nova nasce **sem plano** (`null`); o admin define depois.

**Tech Stack:** Next.js (App Router, server components), Prisma + PostgreSQL, Zod, Vitest, TypeScript.

**Decisões de escopo (deliberadas):**
- `plan` é **nullable**. Contas existentes e cadastros novos começam com `null` (= "não definido"). Não inventamos um default — o admin atribui conscientemente.
- `setPlan` é uma ação **independente** do acesso/pagamento: não mexe em `accessUntil` nem em `billingOverride`. Trocar o plano nunca ativa/suspende a conta.
- Conta admin **pode** ter plano (sem restrição). A única trava de admin existente (não suspender) continua só no `forceSuspend`.
- Nada de gating de feature/limite neste plano. Se aparecer a tentação de "e já que estamos aqui, limitar disparo por plano" — **não**. YAGNI; é o projeto de entitlements separado.

---

## Task 1: Schema — enum `Plan` + campo `User.plan`

**Files:**
- Modify: `prisma/schema.prisma` (adicionar enum perto dos outros enums, ~linha 33; adicionar campo no model `User`, ~linha 50)

**Step 1: Adicionar o enum `Plan`**

Logo após o enum `PaymentMethod` (linha 28-33), adicione:

```prisma
enum Plan {
  INICIAL
  PROFISSIONAL
  ESCALA
}
```

**Step 2: Adicionar o campo no model `User`**

Dentro de `model User`, junto das anotações financeiras (depois de `paymentDueDate DateTime?`, ~linha 51), adicione:

```prisma
  // Plano comercial atribuído pelo admin (rótulo organizacional — NÃO altera
  // acesso nem limites). null = ainda não definido. O admin define no /financeiro.
  plan            Plan?
```

**Step 3: Aplicar no banco e regenerar o client**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." (usa `DIRECT_URL` — porta 5432, não pgbouncer).

Run: `npx prisma generate`
Expected: client regenerado; o tipo `Plan` passa a existir em `@prisma/client`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(planos): enum Plan + campo User.plan (rótulo do admin)"
```

---

## Task 2: Service — ação `setPlan` em `setAccountAccess`

**Files:**
- Modify: `src/server/services/account.service.ts` (união `AccessAction` ~linha 80-93; tipo de `data` ~linha 115-120; `switch` ~linha 121-197)
- Test: `src/server/services/account.service.test.ts`

**Step 1: Escrever o teste que falha**

Em `src/server/services/account.service.test.ts`, dentro do bloco `describe("setAccountAccess", ...)` (após o teste de trial), adicione:

```ts
  it("setPlan: grava o plano sem tocar em acesso/override", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: FUTURE,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");

    await setAccountAccess("u-cli", { kind: "setPlan", plan: "PROFISSIONAL" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-cli" },
      data: { plan: "PROFISSIONAL" },
      select: { id: true },
    });
  });

  it("setPlan: aceita null (remover plano)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u-cli",
      email: "cliente@exemplo.com",
      accessUntil: FUTURE,
    });
    (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
    const { setAccountAccess } = await import("./account.service");

    await setAccountAccess("u-cli", { kind: "setPlan", plan: null });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-cli" },
      data: { plan: null },
      select: { id: true },
    });
  });
```

**Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: FAIL — TypeScript/runtime não reconhece `kind: "setPlan"` (a união não tem esse membro).

**Step 3: Implementar a ação**

3a. No import do topo, acrescente `Plan` ao import de tipos do Prisma (linha 4):

```ts
import type { PaymentMethod, Plan } from "@prisma/client";
```

3b. Na união `AccessAction` (após o membro `setInfo`, ~linha 93), adicione:

```ts
  | { kind: "setPlan"; plan: Plan | null }; // rótulo comercial; não toca em acesso/override
```

3c. No tipo da variável `data` (~linha 115-120), adicione a propriedade `plan`:

```ts
  let data: {
    billingOverride?: BillingOverride;
    accessUntil?: Date;
    paymentMethod?: PaymentMethod | null;
    paymentDueDate?: Date | null;
    plan?: Plan | null;
  };
```

3d. No `switch (action.kind)`, adicione um case (antes do `case "setInfo":` está ótimo):

```ts
    case "setPlan":
      // Só o rótulo. Não mexe em billingOverride/accessUntil de propósito.
      data = { plan: action.plan };
      break;
```

O case cai no `prisma.user.update({ where, data, select })` genérico do fim da função (linha ~199) — nada mais a fazer.

**Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/server/services/account.service.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 2 novos).

**Step 5: Commit**

```bash
git add src/server/services/account.service.ts src/server/services/account.service.test.ts
git commit -m "feat(planos): acao setPlan no setAccountAccess (sem afetar acesso)"
```

---

## Task 3: API — aceitar `setPlan` na rota de billing

**Files:**
- Modify: `src/app/api/admin/accounts/[id]/billing/route.ts` (schema Zod ~linha 11-25)

**Step 1: Adicionar o membro ao schema Zod**

No `z.discriminatedUnion("kind", [...])`, acrescente (logo após o membro `setInfo`):

```ts
    z.object({
      kind: z.literal("setPlan"),
      plan: z.enum(["INICIAL", "PROFISSIONAL", "ESCALA"]).nullable(),
    }),
```

**Step 2: Confirmar o roteamento da ação**

Nenhuma mudança no corpo do handler é necessária: `setPlan` não tem campos `Date`, então cai no ramo final `action = parsed.data as AccessAction` (linha ~53-54) e é repassado direto. Releia as linhas 43-55 para confirmar que `setPlan` não bate em `setUntil`/`setInfo` e cai no `else`.

**Step 3: Verificação de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (o `as AccessAction` cobre o novo membro, que agora existe na união).

**Step 4: Commit**

```bash
git add "src/app/api/admin/accounts/[id]/billing/route.ts"
git commit -m "feat(planos): API de billing aceita kind=setPlan"
```

---

## Task 4: Admin — incluir `plan` na linha de conta

**Files:**
- Modify: `src/server/services/account.service.ts` (`AdminAccountRow` ~linha 30-44; `listAccountsForAdmin` select ~linha 50-61 e map ~linha 62-76)

**Step 1: Adicionar `plan` à interface `AdminAccountRow`**

Em `AdminAccountRow`, junto dos demais campos (após `paymentDueDate: Date | null;`):

```ts
  plan: Plan | null;
```

**Step 2: Selecionar e mapear o campo**

2a. No `prisma.user.findMany({ select: { ... } })`, adicione `plan: true,` (junto de `paymentDueDate: true,`).

2b. No `.map((u) => ({ ... }))`, adicione `plan: u.plan,` (junto de `paymentDueDate: u.paymentDueDate,`).

**Step 3: Verificação de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Não há teste unitário dedicado a `listAccountsForAdmin` — é um passa-direto do Prisma; a checagem de tipos cobre o contrato.)

**Step 4: Commit**

```bash
git add src/server/services/account.service.ts
git commit -m "feat(planos): AdminAccountRow expoe o plano da conta"
```

---

## Task 5: UI — seção "Plano" no modal + coluna no Financeiro

**Files:**
- Modify: `src/components/app/AccountAccessModal.tsx` (tipo `Action` ~linha 11-23; props ~linha 37-51; corpo do modal)
- Modify: `src/app/(app)/financeiro/page.tsx` (cabeçalho/linhas da tabela ~linha 104-166; passar prop ao modal ~linha 156-163)

**Step 1: Modal — estender o tipo `Action` e as props**

1a. Tipo `Plan` local + membro na união `Action` (após o membro `setInfo`, ~linha 23):

```ts
type Plan = "INICIAL" | "PROFISSIONAL" | "ESCALA";

// ... dentro da união Action:
  | { kind: "setPlan"; plan: Plan | null };
```

1b. Mapa de rótulos, perto de `METHOD_LABELS` (~linha 25):

```ts
const PLAN_LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};
```

1c. Nova prop `plan` na assinatura do componente (junto de `paymentDueDate`):

```ts
  plan,
}: {
  accountId: string;
  active: boolean;
  isAdmin: boolean;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: string | null;
  plan: Plan | null;
}) {
```

1d. Estado local do select (junto dos outros `useState`, ~linha 57):

```ts
  const [planValue, setPlanValue] = useState<Plan | "">(plan ?? "");
```

**Step 2: Modal — renderizar a seção "Plano"**

Logo após o `<p>` de status (linha ~99-102), antes de "Liberar teste", adicione:

```tsx
          {/* Plano comercial (rótulo). Não altera acesso/limites — só registro. */}
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Plano
            </p>
            <div className="flex gap-2">
              <select
                value={planValue}
                onChange={(e) => setPlanValue(e.target.value as Plan | "")}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— não definido —</option>
                {(Object.keys(PLAN_LABELS) as Plan[]).map((p) => (
                  <option key={p} value={p}>{PLAN_LABELS[p]}</option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => send({ kind: "setPlan", plan: planValue || null })}
                className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Apenas organização/cobrança. Não altera acesso nem limites da conta.
            </p>
          </div>
```

**Step 3: Financeiro — passar a prop e adicionar a coluna**

3a. Mapa de rótulos no topo do arquivo, perto de `METHOD_LABELS` (~linha 20):

```ts
const PLAN_LABELS = { INICIAL: "Inicial", PROFISSIONAL: "Profissional", ESCALA: "Escala" } as const;
```

3b. Cabeçalho da tabela: adicione `<Th>Plano</Th>` entre `<Th>Conta</Th>` e `<Th>Chips</Th>` (linha ~107-108).

3c. Célula na linha: adicione, logo após a `<Td>` da conta (após linha ~130):

```tsx
                <Td>
                  {a.plan ? (
                    <Badge tone="blue">{PLAN_LABELS[a.plan]}</Badge>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
```

3d. Passe a prop ao modal (no `<AccountAccessModal ... />`, ~linha 156-163):

```tsx
                    plan={a.plan}
```

**Step 4: Verificação de tipos + build do componente**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 5: Verificação manual**

Run: `npm run dev` e acesse `/financeiro` como admin.
Expected:
- Coluna "Plano" aparece (mostra "—" para contas sem plano).
- "Gerenciar" → seção "Plano" com select; escolher "Profissional" + "Salvar" → recarrega e o badge azul "Profissional" aparece na linha.
- O status (Ativo/Suspenso) e a validade **não mudam** ao salvar o plano.

**Step 6: Commit**

```bash
git add src/components/app/AccountAccessModal.tsx "src/app/(app)/financeiro/page.tsx"
git commit -m "feat(planos): seletor de plano no modal + coluna no Financeiro"
```

---

## Checklist final

- [ ] `npx vitest run` — suíte verde
- [ ] `npx tsc --noEmit` — sem erros
- [ ] Atribuir/limpar plano no `/financeiro` funciona e **não** mexe no acesso
- [ ] Conta nova (cadastro) nasce com plano `null` (nenhuma mudança em `registerUser` — confirmado por inspeção, não precisa de código)

## Fora de escopo (próxima conversa — "specs dos planos")

- Régua/entitlements: limitar nº de números, **medir** disparo mensal, gatear CRM/campanhas por plano.
- Resolver os dois bullets vaporware do Escala: **API pública** e **multiusuário** (construir ou remover da landing).
- Reconciliar os tetos de disparo (1.000/10.000) com a economia Baileys vs Cloud API.
