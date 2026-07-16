# Dashboard Financeiro + Ledger de Pagamentos Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Dar ao admin uma visão de **receita** (quanto entrou, quando, por quem) que hoje não existe. O sistema atual só guarda o **estado** da conta (`accessUntil`, `billingOverride`, `paymentMethod`, `paymentDueDate`) — cada ação sobrescreve a anterior e **nenhum valor em R$ é gravado**. Introduzimos um **ledger** (`Payment`): toda vez que o admin lança um pagamento com valor, nasce um registro imutável. O painel `/financeiro` ganha **cards de resumo** + **extrato** + **filtros** (período + status), lendo o ledger. O gate de acesso **não muda em nada**.

**Architecture:**
- **Ledger separado, não campo na conta.** Pagamento é um *evento* (`Payment` 1—N `User`), não um estado. Isso dá histórico, soma por período, e deixa o caminho aberto p/ reembolso (lançamento à parte) sem reescrever nada. O estado da conta (`accessUntil`) continua sendo a fonte de verdade do *acesso*; o ledger é a fonte de verdade da *receita*. Um não depende do outro.
- **Valor é OPCIONAL no lançamento** (decisão tomada). O fluxo "Lançar pagamento" (`setInfo`) ganha um campo de valor que pode ficar vazio: vazio = comportamento de hoje (anota forma/vencimento, mexe no acesso, **não** gera receita); preenchido = também cria um `Payment`. Trials (botões "Trial 3/7 dias", ação `extend`) continuam **sem valor** por definição — são grátis.
- **Dinheiro em centavos (`Int`).** Nunca `Float` para moeda. `amountCents = 12990` ⇒ R$ 129,90. Formatação só na borda (UI).
- **Receita = regime de caixa.** "Receita do mês" = soma dos `Payment.paidAt` dentro do mês. Não é MRR, não é competência/accrual — é o que entrou no caixa. Simples e auditável; MRR/projeção fica fora (over-engineering p/ agora).
- **Dashboard server-side, filtros por querystring.** A página já é server component `force-dynamic`. Filtros (período, status) viram `searchParams` (`?month=2026-06&status=ativo`) — zero estado client, links compartilháveis, recarrega no servidor. O extrato também é renderizado no servidor.
- **Status de conta é calculado, não coluna.** "Ativa/Suspensa" sai de `accountActive()`; "Trial" vs "Pagante" se deriva do ledger (pagante = tem ≥1 `Payment`). Ver decisão D3.

**Tech Stack:** Next.js (App Router, server components, `searchParams`), Prisma + PostgreSQL (`prisma db push`, **não** `migrate` — ver topo de [prisma/schema.prisma](../../prisma/schema.prisma)), Vitest (`vi.mock` do prisma), TypeScript, lucide-react, Tailwind. Componentes de UI já existentes: `Card`, `Badge`, `Table/Th/Td`, `Modal`.

---

## Convenções deste repositório (leia antes de começar)

- **Migrations:** `npx prisma db push` seguido de `npx prisma generate`. Tabela nova + relação opcional = **aditivo**, não-destrutivo. Sem `migrate dev`.
- **Centavos:** todo valor monetário é `Int` em centavos no banco e no domínio. String "R$ 129,90" só existe na UI. Helper de parse/format em `src/lib/money.ts` (criado na Phase 0).
- **Testes:** Vitest, alias `@/`. Padrão `vi.mock("@/server/db/client", () => ({ prisma: { ... } }))`. Modelo em [src/server/services/account.service.test.ts](../../src/server/services/account.service.test.ts).
- **Datas determinísticas em teste:** `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-06-27T12:00:00Z"))`.
- **Rodar um teste:** `npx vitest run <caminho> -t "<nome>"`.
- **Admin idiom:** `isAdminEmail(email)` de [src/lib/admin.ts](../../src/lib/admin.ts).
- **Commits:** um por tarefa, pt-BR estilo do repo (`feat(financeiro): ...`).

---

## Estado atual (o que existe hoje)

| Peça | Hoje | No plano |
|---|---|---|
| `User.accessUntil` / `billingOverride` | controlam acesso | **não muda** |
| `User.paymentMethod` / `paymentDueDate` | anotação (forma/vencimento) | **não muda** (continua sendo o "último/padrão") |
| Ação `setInfo` ("Lançar pagamento") | grava forma + vencimento; vencimento libera acesso. **Sem valor.** | + `amountCents` opcional → quando preenchido, **cria `Payment`** |
| Ação `extend` (trial 3/7) | move a data | **não muda** (trial é grátis, sem valor) |
| Receita / histórico | **não existe** | tabela `Payment` (ledger) |
| `/financeiro` | tabela de contas | + cards de resumo + extrato + filtros |

> Verificado em [account.service.ts:133-142](../../src/server/services/account.service.ts#L133-L142) (o `setInfo` de hoje) e [AccountAccessModal.tsx:132-166](../../src/components/app/AccountAccessModal.tsx#L132-L166) (a seção "Lançar pagamento", sem campo de valor).

---

## Phase 0 — Fundação: helper de dinheiro + model `Payment`

### Task 0.1: Helper puro de centavos (`src/lib/money.ts`)

**Files:**
- Create: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Step 1: Teste que falha**

```typescript
// src/lib/money.test.ts
import { describe, it, expect } from "vitest";
import { parseBRLToCents, formatCentsBRL } from "./money";

describe("parseBRLToCents", () => {
  it("aceita '129,90' -> 12990", () => expect(parseBRLToCents("129,90")).toBe(12990));
  it("aceita '1.299,90' -> 129990 (separador de milhar)", () => expect(parseBRLToCents("1.299,90")).toBe(129990));
  it("aceita '129.90' (ponto decimal) -> 12990", () => expect(parseBRLToCents("129.90")).toBe(12990));
  it("aceita inteiro '150' -> 15000", () => expect(parseBRLToCents("150")).toBe(15000));
  it("ignora 'R$' e espaços", () => expect(parseBRLToCents(" R$ 99,00 ")).toBe(9900));
  it("vazio -> null", () => expect(parseBRLToCents("")).toBe(null));
  it("lixo -> null", () => expect(parseBRLToCents("abc")).toBe(null));
  it("negativo -> null (não aceitamos no lançamento)", () => expect(parseBRLToCents("-10")).toBe(null));
});

describe("formatCentsBRL", () => {
  it("12990 -> 'R$ 129,90'", () => expect(formatCentsBRL(12990)).toBe("R$ 129,90"));
  it("0 -> 'R$ 0,00'", () => expect(formatCentsBRL(0)).toBe("R$ 0,00"));
});
```

**Step 2: Rodar e ver falhar** — `npx vitest run src/lib/money.test.ts`

**Step 3: Implementar**

```typescript
// src/lib/money.ts

/**
 * "R$ 1.299,90" | "129,90" | "129.90" | "150" -> centavos (Int).
 * Aceita vírgula OU ponto como decimal; ponto como milhar quando há vírgula.
 * Retorna null para vazio/ inválido/ negativo (lançamento não aceita negativo).
 */
export function parseBRLToCents(raw: string): number | null {
  const s = raw.replace(/[R$\s]/g, "");
  if (!s) return null;
  // Se tem vírgula, ela é o decimal e ponto é milhar: "1.299,90" -> "1299.90".
  // Senão, ponto (se houver) já é o decimal: "129.90" -> "129.90".
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(parseFloat(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

/** centavos (Int) -> "R$ 129,90" (pt-BR). */
export function formatCentsBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
```

**Step 4: Rodar e ver passar** — `npx vitest run src/lib/money.test.ts`

**Step 5: Commit** — `feat(financeiro): helper de dinheiro em centavos (parse/format BRL)`

### Task 0.2: Model `Payment` no schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1:** Adicionar o model (após `model User`, perto dos outros modelos):

```prisma
// Ledger de receita: cada pagamento lançado pelo admin é um registro imutável.
// Fonte de verdade da RECEITA (o acesso continua em User.accessUntil). Reembolso,
// no futuro, é um lançamento à parte (amountCents negativo) — não editamos linha.
model Payment {
  id          String         @id @default(cuid())
  accountId   String         // conta que pagou (User.id)
  account     User           @relation(fields: [accountId], references: [id], onDelete: Cascade)
  amountCents Int            // valor em centavos (BRL). > 0 no lançamento normal.
  method      PaymentMethod? // forma usada NESTE pagamento (snapshot; pode diferir do padrão da conta)
  paidAt      DateTime       @default(now()) // quando entrou (data do lançamento) — base da "receita do mês"
  coversUntil DateTime?      // até quando este pagamento estendeu o acesso (snapshot do accessUntil resultante)
  note        String?        // observação livre do admin (opcional)
  createdAt   DateTime       @default(now())

  @@index([accountId])
  @@index([paidAt])
}
```

**Step 2:** No `model User`, adicionar a relação inversa (junto das outras relações, ex.: perto de `leads`/`whatsAppNumbers`):

```prisma
  payments Payment[]
```

**Step 3: Aplicar e regerar**

Run: `npx prisma db push`
Expected: `Your database is now in sync` — cria a tabela `Payment` (vazia). Aditivo.

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

**Step 4: Commit** — `feat(financeiro): model Payment (ledger de receita)`

---

## Phase 1 — Serviço: gravar e consultar o ledger

### Task 1.1: `setInfo` cria `Payment` quando há valor

**Files:**
- Modify: `src/server/services/account.service.ts`
- Modify: `src/server/services/account.service.test.ts`

**Step 1: Teste que falha** — adicionar ao describe de `setAccountAccess`:

```typescript
it("setInfo COM valor cria Payment + estende acesso (transação)", async () => {
  const { prisma } = await import("@/server/db/client");
  (prisma.user.findUnique as any).mockResolvedValue({ id: "u-cli", email: "c@x.com", accessUntil: null });
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      user: { update: vi.fn().mockResolvedValue({ id: "u-cli" }) },
      payment: { create: vi.fn().mockResolvedValue({ id: "pay-1" }) },
    }),
  );
  const { setAccountAccess } = await import("./account.service");
  const due = new Date("2026-07-27T12:00:00Z");
  await setAccountAccess("u-cli", {
    kind: "setInfo", paymentMethod: "PIX", paymentDueDate: due, amountCents: 12990,
  });
  expect(prisma.$transaction).toHaveBeenCalled();
});

it("setInfo SEM valor não cria Payment (só update da conta)", async () => {
  const { prisma } = await import("@/server/db/client");
  (prisma.user.findUnique as any).mockResolvedValue({ id: "u-cli", email: "c@x.com", accessUntil: null });
  (prisma.user.update as any).mockResolvedValue({ id: "u-cli" });
  const { setAccountAccess } = await import("./account.service");
  await setAccountAccess("u-cli", {
    kind: "setInfo", paymentMethod: "PIX", paymentDueDate: null, amountCents: null,
  });
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(prisma.user.update).toHaveBeenCalled();
});
```

> Adicionar `$transaction: vi.fn()` e `payment: { create: vi.fn() }` ao mock do prisma no topo do arquivo de teste.

**Step 2: Rodar e ver falhar** — `npx vitest run src/server/services/account.service.test.ts`

**Step 3: Implementar** — estender o tipo `AccessAction.setInfo` com `amountCents` e reescrever o `case "setInfo"`:

```typescript
  | {
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: Date | null;
      amountCents: number | null; // null/0 = não registra receita; >0 = cria Payment
    };
```

No `switch`, trocar o `case "setInfo"` por:

```typescript
    case "setInfo": {
      // Monta o update da conta (igual a hoje): forma + vencimento; vencimento libera acesso.
      const data: typeof baseData = {
        paymentMethod: action.paymentMethod,
        paymentDueDate: action.paymentDueDate,
      };
      if (action.paymentDueDate) {
        data.billingOverride = "AUTO";
        data.accessUntil = action.paymentDueDate;
      }
      // Com valor: grava o update E o Payment atomicamente (ledger não diverge do acesso).
      if (action.amountCents && action.amountCents > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: userId }, data, select: { id: true } });
          await tx.payment.create({
            data: {
              accountId: userId,
              amountCents: action.amountCents!,
              method: action.paymentMethod,
              coversUntil: action.paymentDueDate, // snapshot do prazo que este pgto cobriu
            },
          });
        });
        return { id: userId };
      }
      // Sem valor: comportamento de hoje, só o update.
      await prisma.user.update({ where: { id: userId }, data, select: { id: true } });
      return { id: userId };
    }
```

> Refatorar o início da função para extrair `baseData` (o objeto `data` declarado em [account.service.ts:111-116](../../src/server/services/account.service.ts#L111-L116)) de forma que os outros `case`s continuem retornando via o `prisma.user.update` único no fim. Alternativa mais limpa: dar `return` em cada `case` (como o `setInfo` faz) e remover o `update` final compartilhado. Escolher o caminho que deixar o diff menor e os testes existentes (`extend`/`forceActive`/trava admin) passando inalterados.

**Step 4: Rodar e ver passar** — `npx vitest run src/server/services/account.service.test.ts`

**Step 5: Commit** — `feat(financeiro): setInfo grava Payment quando há valor (transação)`

### Task 1.2: Consultas do dashboard (resumo + extrato)

**Files:**
- Create: `src/server/services/payment.service.ts`
- Test: `src/server/services/payment.service.test.ts`

**Step 1: Definir a API do serviço** (sem I/O na assinatura — recebe janela de datas já calculada):

```typescript
// src/server/services/payment.service.ts
import { prisma } from "@/server/db/client";
import type { PaymentMethod } from "@prisma/client";

export interface PaymentRow {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail: string;
  amountCents: number;
  method: PaymentMethod | null;
  paidAt: Date;
  coversUntil: Date | null;
}

/** Soma de receita (centavos) entre [from, to). to exclusivo. */
export async function revenueCents(from: Date, to: Date): Promise<number> {
  const r = await prisma.payment.aggregate({
    _sum: { amountCents: true },
    where: { paidAt: { gte: from, lt: to } },
  });
  return r._sum.amountCents ?? 0;
}

/** Receita acumulada de todos os tempos (centavos). */
export async function revenueTotalCents(): Promise<number> {
  const r = await prisma.payment.aggregate({ _sum: { amountCents: true } });
  return r._sum.amountCents ?? 0;
}

/** Extrato: pagamentos no período [from, to), mais recentes primeiro. */
export async function listPayments(from: Date, to: Date): Promise<PaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: { paidAt: { gte: from, lt: to } },
    orderBy: { paidAt: "desc" },
    select: {
      id: true, accountId: true, amountCents: true, method: true, paidAt: true, coversUntil: true,
      account: { select: { name: true, email: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id, accountId: p.accountId, accountName: p.account.name, accountEmail: p.account.email,
    amountCents: p.amountCents, method: p.method, paidAt: p.paidAt, coversUntil: p.coversUntil,
  }));
}
```

**Step 2: Teste** (mock do prisma, valida o `where` da janela e o mapeamento):

```typescript
// src/server/services/payment.service.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
beforeAll(() => { process.env.DATABASE_URL ||= "postgresql://t:t@localhost:5432/t?schema=public"; });
vi.mock("@/server/db/client", () => ({
  prisma: { payment: { aggregate: vi.fn(), findMany: vi.fn() } },
}));

describe("revenueCents", () => {
  beforeEach(() => vi.clearAllMocks());
  it("soma o período e trata vazio como 0", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.payment.aggregate as any).mockResolvedValue({ _sum: { amountCents: null } });
    const { revenueCents } = await import("./payment.service");
    expect(await revenueCents(new Date("2026-06-01"), new Date("2026-07-01"))).toBe(0);
    const arg = (prisma.payment.aggregate as any).mock.calls[0][0];
    expect(arg.where.paidAt.gte).toEqual(new Date("2026-06-01"));
    expect(arg.where.paidAt.lt).toEqual(new Date("2026-07-01"));
  });
});

describe("listPayments", () => {
  beforeEach(() => vi.clearAllMocks());
  it("achata account.name/email na linha", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.payment.findMany as any).mockResolvedValue([
      { id: "p1", accountId: "u1", amountCents: 12990, method: "PIX",
        paidAt: new Date("2026-06-10"), coversUntil: null,
        account: { name: "Cliente X", email: "x@y.com" } },
    ]);
    const { listPayments } = await import("./payment.service");
    const rows = await listPayments(new Date("2026-06-01"), new Date("2026-07-01"));
    expect(rows[0]).toMatchObject({ accountName: "Cliente X", accountEmail: "x@y.com", amountCents: 12990 });
  });
});
```

**Step 3: Rodar** — `npx vitest run src/server/services/payment.service.test.ts` (falha → passa).

**Step 4: Helper de janela de mês** — em `src/lib/money.ts` ou um novo `src/lib/period.ts`:

```typescript
// src/lib/period.ts
/** "2026-06" -> [00:00 do dia 1, 00:00 do dia 1 do mês seguinte). UTC. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
}
/** "YYYY-MM" do mês atual (para default do filtro). */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
```

(Teste curto opcional para `monthRange` em `src/lib/period.test.ts`.)

**Step 5: Commit** — `feat(financeiro): consultas de receita e extrato (payment.service)`

---

## Phase 2 — API: aceitar valor no lançamento

### Task 2.1: Rota aceita `amountCents` no `setInfo`

**Files:**
- Modify: `src/app/api/admin/accounts/[id]/billing/route.ts`

**Step 1:** No schema zod do `setInfo`, adicionar `amountCents` opcional:

```typescript
  z.object({
    kind: z.literal("setInfo"),
    paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "TRANSFERENCIA"]).nullable(),
    paymentDueDate: z.string().datetime().nullable(),
    amountCents: z.number().int().positive().nullable(), // centavos; null = sem receita
  }),
```

**Step 2:** Na montagem da `action` p/ `setInfo`, passar `amountCents`:

```typescript
    action = {
      kind: "setInfo",
      paymentMethod: parsed.data.paymentMethod,
      paymentDueDate: parsed.data.paymentDueDate ? new Date(parsed.data.paymentDueDate) : null,
      amountCents: parsed.data.amountCents,
    };
```

**Step 3:** `npx tsc --noEmit` — sem erros.

**Step 4: Commit** — `feat(financeiro): API aceita amountCents no lançamento`

---

## Phase 3 — UI: campo de valor no modal

### Task 3.1: Campo "Valor" na seção "Lançar pagamento"

**Files:**
- Modify: `src/components/app/AccountAccessModal.tsx`

**Step 1:** Importar o parser e adicionar estado:

```typescript
import { parseBRLToCents } from "@/lib/money";
// ...
const [amount, setAmount] = useState<string>("");
```

**Step 2:** Estender o type `Action.setInfo` (no client) com `amountCents: number | null` e `saveInfo`:

```typescript
function saveInfo() {
  const dueIso = due ? new Date(`${due}T12:00:00.000Z`).toISOString() : null;
  const amountCents = amount.trim() ? parseBRLToCents(amount) : null;
  if (amount.trim() && amountCents == null) { alert("Valor inválido. Ex.: 129,90"); return; }
  return send({ kind: "setInfo", paymentMethod: method || null, paymentDueDate: dueIso, amountCents });
}
```

**Step 3:** Adicionar o input de valor **antes** do select de forma (seção "Lançar pagamento", após a linha de instrução em [AccountAccessModal.tsx:137-139](../../src/components/app/AccountAccessModal.tsx#L137-L139)):

```tsx
<label className="block">
  <span className="text-xs text-slate-500">Valor (opcional)</span>
  <input
    type="text" inputMode="decimal" placeholder="Ex.: 129,90"
    value={amount} onChange={(e) => setAmount(e.target.value)}
    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
  />
  <span className="mt-1 block text-[11px] text-slate-400">
    Em branco = não registra receita (cortesia/ajuste). Com valor = entra no extrato.
  </span>
</label>
```

**Step 4:** Atualizar o texto da seção ([linha 137-139](../../src/components/app/AccountAccessModal.tsx#L137-L139)) para mencionar o valor. `npx tsc --noEmit`.

**Step 5: Commit** — `feat(financeiro): campo de valor (opcional) no lançamento de pagamento`

---

## Phase 4 — Dashboard: cards + filtros + extrato

### Task 4.1: Cards de resumo + filtro de período/status na `/financeiro`

**Files:**
- Modify: `src/app/(app)/financeiro/page.tsx`
- (opcional) Create: `src/components/app/FinanceiroFilters.tsx` (client, só os selects que dão `router.push` com a querystring)

**Step 1:** A página passa a ler `searchParams` (Next 15: `Promise`). Default: mês atual, status "todos".

```typescript
export default async function FinanceiroPage({
  searchParams,
}: { searchParams: Promise<{ month?: string; status?: string }> }) {
  // ...guard de admin igual a hoje...
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : currentMonth();
  const status = sp.status ?? "todos"; // todos | ativo | suspenso
  const { from, to } = monthRange(month);

  const [accounts, revMonth, revTotal, payments] = await Promise.all([
    listAccountsForAdmin(),
    revenueCents(from, to),
    revenueTotalCents(),
    listPayments(from, to),
  ]);

  const filteredAccounts = accounts.filter((a) =>
    status === "ativo" ? a.active : status === "suspenso" ? !a.active : true,
  );
  const activeCount = accounts.filter((a) => a.active).length;
```

**Step 2: Faixa de cards** (acima da tabela). Usar `Card` + `formatCentsBRL`:

```tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <Card className="p-4">
    <p className="text-xs text-slate-400">Receita ({month})</p>
    <p className="mt-1 text-2xl font-bold text-ink">{formatCentsBRL(revMonth)}</p>
  </Card>
  <Card className="p-4">
    <p className="text-xs text-slate-400">Receita total</p>
    <p className="mt-1 text-2xl font-bold text-ink">{formatCentsBRL(revTotal)}</p>
  </Card>
  <Card className="p-4">
    <p className="text-xs text-slate-400">Pagamentos no mês</p>
    <p className="mt-1 text-2xl font-bold text-ink">{payments.length}</p>
  </Card>
  <Card className="p-4">
    <p className="text-xs text-slate-400">Contas ativas</p>
    <p className="mt-1 text-2xl font-bold text-ink">{activeCount}</p>
  </Card>
</div>
```

**Step 3: Filtros** (client component pequeno; `<input type="month">` + `<select>` de status → `router.push("/financeiro?month=...&status=...")` + `router.refresh()`). Manter simples; sem libs.

**Step 4:** A tabela de contas existente passa a iterar `filteredAccounts` em vez de `accounts`. Nada mais muda nela.

**Step 5:** `npx tsc --noEmit`. **Commit** — `feat(financeiro): cards de receita + filtro de período/status`

### Task 4.2: Extrato (tabela de pagamentos do período)

**Files:**
- Modify: `src/app/(app)/financeiro/page.tsx`

**Step 1:** Abaixo da tabela de contas, um `Card` com `Table`: colunas **Data · Conta · Forma · Cobre até · Valor**. Vazio → linha "Nenhum pagamento neste período.".

```tsx
<Card className="overflow-hidden">
  <div className="border-b border-slate-100 px-4 py-3">
    <p className="text-sm font-bold text-ink">Extrato — {month}</p>
  </div>
  <Table>
    <thead><tr>
      <Th>Data</Th><Th>Conta</Th><Th>Forma</Th><Th>Cobre até</Th><Th>Valor</Th>
    </tr></thead>
    <tbody>
      {payments.length === 0 ? (
        <tr><Td colSpan={5} className="py-8 text-center text-slate-400">Nenhum pagamento neste período.</Td></tr>
      ) : payments.map((p) => (
        <tr key={p.id}>
          <Td className="whitespace-nowrap text-slate-500">{formatDateTime(p.paidAt)}</Td>
          <Td><div className="font-semibold text-ink">{p.accountName}</div>
              <div className="text-xs text-slate-400">{p.accountEmail}</div></Td>
          <Td className="text-slate-600">{p.method ? METHOD_LABELS[p.method] : "—"}</Td>
          <Td className="whitespace-nowrap text-slate-500">{p.coversUntil ? formatDateTime(p.coversUntil) : "—"}</Td>
          <Td className="whitespace-nowrap font-semibold text-ink">{formatCentsBRL(p.amountCents)}</Td>
        </tr>
      ))}
    </tbody>
  </Table>
</Card>
```

> `METHOD_LABELS` já existe inline na página ([financeiro/page.tsx:93](../../src/app/(app)/financeiro/page.tsx#L93)); extraí-lo p/ uma const no topo do arquivo (DRY) e reusar nas duas tabelas. Conferir se `Td` aceita `colSpan` (é um `<td>` simples — provavelmente sim; senão, usar `<td>` cru).

**Step 2:** `npx tsc --noEmit` + `npm run build`. **Commit** — `feat(financeiro): extrato de pagamentos do período`

---

## Phase 5 — Verificação

### Task 5.1: Suite + build
Run: `npx vitest run` · `npx tsc --noEmit` · `npm run build` — tudo PASS/limpo.

### Task 5.2: Roteiro manual (dev, logado como admin)
1. **Lançar com valor:** modal de uma conta → "Lançar pagamento" → Valor `129,90`, Forma `Pix`, Vencimento +30d → "Lançar pagamento". A conta vira Ativo até a data; o **extrato** mostra a linha; **Receita (mês)** soma R$ 129,90.
2. **Lançar sem valor:** outra conta → forma/vencimento, **valor em branco** → salva. Acesso muda, mas **não** aparece no extrato e **não** soma receita.
3. **Valor inválido:** digitar `abc` → alerta, não envia.
4. **Filtro de mês:** trocar o `<input month>` p/ o mês passado → cards e extrato recarregam só com aquele período.
5. **Filtro de status:** "Suspenso" → a tabela de contas mostra só suspensas (extrato/cards não dependem do status).
6. **Trial não vira receita:** usar "Trial 7 dias" (ação `extend`) → acesso estende, extrato/receita **inalterados**.
7. **Centavos:** lançar `1.299,90` → extrato mostra `R$ 1.299,90` (sem erro de float).

---

## Decisões já tomadas
- **D1 — Valor opcional no lançamento** (confirmado pelo usuário). Vazio = sem receita; preenchido = `Payment`. Trials são sempre sem valor.
- **D2 — Ledger separado** (`Payment`), não campo na conta. Acesso e receita são fontes de verdade independentes.
- **Centavos `Int`** em todo o caminho; format só na UI.
- **Receita = caixa** (`paidAt` no período), não MRR/competência.

## Decisões em aberto (bater o martelo antes da Phase 4)
- **D3 — Definição de "Trial" vs "Pagante" nos cards.** Proposta: Trial = conta ativa com **zero** `Payment`; Pagante = ativa com ≥1. Se você não quer esse recorte agora, ficamos só com "Contas ativas" (já no plano) e deixamos o split p/ depois. → **Decidir se inclui os cards Trial/Pagante.**
- **D4 — Quem registrou o pagamento.** Hoje há um único admin, então `Payment` não guarda `registeredBy`. Se for haver mais de um admin no futuro, vale um `registeredById String?`. → **Incluir agora (barato) ou deixar p/ quando houver 2º admin?** Recomendo incluir agora (uma coluna nullable).
- **D5 — Reembolso/estorno.** O modelo já suporta (lançamento negativo), mas **não** vamos construir UI de estorno neste plano. → Confirmar que estorno fica fora do escopo agora.
- **D6 — Editar/excluir lançamento errado.** Ledger é imutável por princípio. Se você lançar errado, hoje não há "desfazer" na UI. → Aceita corrigir via banco por enquanto, ou quer um "estornar" mínimo? (liga com D5).
- **D7 — Período do dashboard.** Plano usa **mês** (`?month=YYYY-MM`). Suficiente? Ou já quer intervalo livre (de/até)? Recomendo começar só com mês.

## Resumo das mudanças (checklist)
| Camada | Arquivo | Mudança |
|---|---|---|
| Helper | `src/lib/money.ts` (novo) | `parseBRLToCents`, `formatCentsBRL` |
| Helper | `src/lib/period.ts` (novo) | `monthRange`, `currentMonth` |
| Schema | `prisma/schema.prisma` | + `model Payment`; `User.payments[]` |
| Serviço | `src/server/services/account.service.ts` | `setInfo` cria `Payment` quando há valor (transação) |
| Serviço | `src/server/services/payment.service.ts` (novo) | `revenueCents`, `revenueTotalCents`, `listPayments` |
| API | `src/app/api/admin/accounts/[id]/billing/route.ts` | `amountCents` no `setInfo` |
| UI | `src/components/app/AccountAccessModal.tsx` | campo "Valor (opcional)" |
| UI | `src/app/(app)/financeiro/page.tsx` | cards + filtros (searchParams) + extrato |
| Testes | `*.test.ts` | money, payment.service, setInfo c/ valor |
</content>
</invoke>
