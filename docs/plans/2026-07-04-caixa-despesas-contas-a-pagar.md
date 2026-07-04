# Caixa — Despesas e Contas a Pagar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar a outra metade do caderno de balcão: além de registrar **o que entra** (comandas, já em produção), dar ao dono um registro do **que sai** — despesas avulsas e **contas a pagar** (com vencimento e status pago/pendente), inclusive **despesas fixas mensais** (aluguel, salário) que se repetem sozinhas — e mostrar o **saldo** (faturamento − despesas pagas) no relatório. Com isso o módulo "Vendas" vira **"Caixa"** de verdade.

**Architecture:** Dois modelos Prisma novos por DONO (`accountId`), no mesmo padrão multi-tenant do módulo de vendas (`onDelete: Cascade`, dinheiro em centavos `Int`): `Expense` (uma conta/lançamento de saída, com `dueDate` + `status` + `paidAt`) e `RecurringExpense` (modelo de despesa fixa mensal). A recorrência **materializa** uma `Expense` PENDENTE por mês de forma **idempotente** (chave única `recurringId + competenceMonth`), gerada preguiçosamente ao listar (sem acoplar ao worker). O **regime é de caixa**: uma despesa entra no saldo do período quando é **paga** (`paidAt` no intervalo), não quando vence — coerente com o faturamento, que já soma comandas por `closedAt`. Reaproveita `src/lib/money.ts`, `getTenantContext`, `resolvePeriod` (`date-range.ts`) e os componentes `Card`/`StatCard` do `ReportsPanel`.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma + Postgres · Zod · TailwindCSS · Vitest (`*.test.ts` co-locado).

**Escopo (o que NÃO entra na v1):** forma de pagamento da despesa (como paguei a conta de luz — baixo valor pro saldo); anexo de comprovante; categorias cadastráveis (enum fixo por decisão); recorrência não-mensal (quinzenal/anual); rateio/centro de custo; DRE; edição de instância recorrente já gerada altera o template (não — o snapshot da instância é imutável, igual `OrderItem`); backfill de meses passados de recorrência (só gera o **mês corrente** em diante).

**Decisões de produto já tomadas (do dono):**
- **Profundidade = contas a pagar + recorrência** (não só livro-caixa). Vencimento, status pago/pendente e despesa fixa mensal.
- **Categorias = enum fixo pequeno**: `ALUGUEL`, `FORNECEDOR`, `PESSOAL`, `CONTAS`, `IMPOSTOS`, `OUTRO`.
- **Relatório mostra o Saldo** (faturamento − despesas pagas) junto do faturamento.
- **Módulo renomeado para "Caixa"** (rota `/caixa`). Rename é **só da superfície visível** (rota + nav + títulos); pastas internas (`src/components/vendas/`) e API (`/api/vendas/*`) **ficam como estão** pra não arriscar/churnar o código já em produção. Um follow-up pode renomear as internas.
- **Despesas são coisa de dono/gerente**: aba e toda escrita exigem `canSettings` (diferente da comanda, que qualquer operador registra).

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest, co-locado (`foo.ts` → `foo.test.ts`). Rodar um: `npx vitest run caminho/arquivo.test.ts`. Os `*.service.test.ts` tocam o **banco de dev** e criam um usuário-dono descartável por teste (padrão de `catalog.service.test.ts`).
- **Schema:** dev usa `npx prisma db push`. **Produção** tem cutover pendente p/ `migrate deploy` (memória `crm-inbox-db-push-pending`) — NÃO rode migrate em prod. Cada mudança ganha um SQL manual idempotente em `prisma/manual/` (padrão de `prisma/manual/2026-07-03-vendas.sql`), aplicado no Supabase SQL Editor pelo dono.
- **Dinheiro:** SEMPRE centavos (`Int`). `parseBRLToCents` / `formatCentsBRL` de `src/lib/money.ts` só na borda (UI). Nunca float.
- **Tenancy:** dono é `ctx.tenantUserId`; operador é `ctx.sessionUserId`. Todo dado escopado por `accountId = ctx.tenantUserId`.
- **Rotas de API:** espelhe `src/app/api/vendas/catalog/route.ts` — `dynamic = "force-dynamic"`, `getTenantContext()`, 401 sem sessão, **403 sem `perms.canSettings`** (despesa é sensível), zod no body, `try/catch → { error }` legível (nunca 500 vazio).
- **Fuso:** períodos e datas de calendário em `America/Sao_Paulo` — use os helpers de `date-range.ts`.
- **Commits frequentes** ao fim de cada task.

---

## Visão geral das fases

- **Fase 0** — Schema (`Expense` / `RecurringExpense` + enums) + helper `competenceMonth` + push dev + SQL manual de prod.
- **Fase 1** — `expense.service` (TDD): CRUD de despesa, marcar paga, listar (a pagar / pagas), CRUD de recorrente e **materialização idempotente** do mês. O coração.
- **Fase 2** — API de despesas e recorrentes (tudo `canSettings`).
- **Fase 3** — Relatório: `expense-report.service` (TDD) + estender a rota de reports com **despesas + saldo por categoria** + cards no `ReportsPanel`.
- **Fase 4** — UI da aba "Despesas" + rename do módulo para **Caixa** (rota, redirect, nav, títulos). Verificação E2E.

Cada fase é entregável e reversível de forma independente.

---

# FASE 0 — Modelos de dados

## Task 0.1: Enums + modelos no schema

**Files:**
- Modify: `prisma/schema.prisma` (2 enums + 2 models + relações inversas em `User`)

**Step 1: Enums** (perto dos enums de vendas, ex.: após `enum OrderPayment`, ~linha 64):

```prisma
enum ExpenseCategory {
  ALUGUEL // aluguel/ocupação
  FORNECEDOR // mercadoria/insumo
  PESSOAL // salário/pró-labore/comissão
  CONTAS // luz/água/internet/telefone
  IMPOSTOS // impostos/taxas
  OUTRO
}

enum ExpenseStatus {
  PENDENTE
  PAGA
}
```

**Step 2: Models** (após o model `OrderItem`, por proximidade de "módulo de caixa", ~linha 280):

```prisma
// Despesa / conta a pagar da conta. Pode ser AVULSA ou uma materialização de uma
// despesa recorrente (recurringId). Regime de CAIXA: entra no "saldo" quando PAGA
// (paidAt no período), não quando vence. Snapshot imutável: editar o RecurringExpense
// NÃO altera instâncias já geradas (igual OrderItem x CatalogItem).
model Expense {
  id          String          @id @default(cuid())
  accountId   String // User.id do dono (tenant)
  account     User            @relation("ExpenseAccount", fields: [accountId], references: [id], onDelete: Cascade)
  description String
  amountCents Int // valor em centavos (BRL), >= 0
  category    ExpenseCategory @default(OUTRO)
  status      ExpenseStatus   @default(PENDENTE)
  dueDate     DateTime // vencimento (data da conta); base do "a vencer/vencidas"
  paidAt      DateTime? // quando foi paga; base do saldo (regime de caixa)
  note        String?
  createdById String // quem lançou (operador/dono)
  createdBy   User            @relation("ExpenseCreatedBy", fields: [createdById], references: [id])
  // Origem recorrente (null = avulsa). competenceMonth "YYYY-MM" garante 1 por mês.
  recurringId     String?
  recurring       RecurringExpense? @relation(fields: [recurringId], references: [id], onDelete: SetNull)
  competenceMonth String? // "YYYY-MM" quando veio de recorrência; null quando avulsa
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  // Idempotência da geração mensal. Avulsas têm (null, null) → Postgres trata NULLs
  // como distintos, então várias avulsas coexistem sem colidir.
  @@unique([recurringId, competenceMonth])
  @@index([accountId, status, dueDate])
  @@index([accountId, paidAt])
}

// Modelo de despesa fixa mensal (aluguel, salário, internet). Gera UMA Expense
// PENDENTE por mês, de forma idempotente. Desativar para parar de gerar.
model RecurringExpense {
  id          String          @id @default(cuid())
  accountId   String
  account     User            @relation("RecurringExpenseAccount", fields: [accountId], references: [id], onDelete: Cascade)
  description String
  amountCents Int
  category    ExpenseCategory @default(OUTRO)
  dayOfMonth  Int // dia do vencimento (1..31; clampa ao último dia em meses curtos)
  active      Boolean         @default(true)
  createdById String
  createdBy   User            @relation("RecurringExpenseCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  expenses    Expense[]

  @@index([accountId, active])
}
```

**Step 3: Relações inversas** em `model User`, junto das de vendas (~linha 169, após `ordersOpened`):

```prisma
  expenses                 Expense[]          @relation("ExpenseAccount")
  expensesCreated          Expense[]          @relation("ExpenseCreatedBy")
  recurringExpenses        RecurringExpense[] @relation("RecurringExpenseAccount")
  recurringExpensesCreated RecurringExpense[] @relation("RecurringExpenseCreatedBy")
```

> **Atenção:** cada model tem DUAS relações para `User` (`account` e `createdBy`), então os nomes (`"ExpenseAccount"`/`"ExpenseCreatedBy"` etc.) são obrigatórios e precisam bater com as inversas.

**Step 4: Aplicar no dev**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." + client regenerado.
Run (se necessário): `npx prisma generate`

> Se der EPERM no rename da DLL do query-engine, PARE o `next dev` antes (memória `prisma-generate-dev-server-lock`).

Run: `npx tsc --noEmit`
Expected: sem erros novos.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(caixa): modelos Expense/RecurringExpense (despesas e contas a pagar por conta)"
```

---

## Task 0.2: SQL manual para produção (não aplicar aqui)

**Files:**
- Create: `prisma/manual/2026-07-04-caixa-despesas.sql`

Gere o DDL exato e adapte para idempotência (padrão do de vendas):

Run: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` e copie SÓ os blocos novos (`ExpenseCategory`, `ExpenseStatus`, `Expense`, `RecurringExpense` + índices + FKs). Confira nomes de índice/constraint gerados pelo Prisma — ele é a fonte de verdade.

**Conteúdo esperado** (ajuste aos nomes do Prisma se divergir):

```sql
-- Cria Expense/RecurringExpense (despesas e contas a pagar do módulo Caixa).
-- Aplicar em PROD manualmente (Supabase SQL Editor) — cutover p/ migrate pendente.
-- Idempotente e ADITIVO. Bate com o DDL gerado pelo Prisma.

DO $$ BEGIN CREATE TYPE "ExpenseCategory" AS ENUM ('ALUGUEL','FORNECEDOR','PESSOAL','CONTAS','IMPOSTOS','OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExpenseStatus" AS ENUM ('PENDENTE','PAGA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RecurringExpense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "dayOfMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringExpense_accountId_active_idx" ON "RecurringExpense"("accountId", "active");

CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDENTE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "recurringId" TEXT,
    "competenceMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_recurringId_competenceMonth_key" ON "Expense"("recurringId", "competenceMonth");
CREATE INDEX IF NOT EXISTS "Expense_accountId_status_dueDate_idx" ON "Expense"("accountId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Expense_accountId_paidAt_idx" ON "Expense"("accountId", "paidAt");

DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NÃO precisa GRANT em PROD: o app conecta como `postgres` e as tabelas nascem com
-- owner = postgres. Omitir o GRANT também evita expor via Data API (anon/authenticated).
-- Validar: select to_regclass('public."Expense"'), to_regclass('public."RecurringExpense"');
```

**Step 2: Commit** (só registro; aplicação em prod é manual pelo dono)

```bash
git add prisma/manual/2026-07-04-caixa-despesas.sql
git commit -m "chore(db): SQL manual das tabelas de despesas do Caixa (aplicação manual em prod)"
```

---

## Task 0.3: Helper de mês-competência (fuso do projeto)

**Files:**
- Modify: `src/server/services/date-range.ts` (adicionar `competenceMonth` + expor `dueDateForDayOfMonth`)
- Test: `src/server/services/date-range.test.ts` (criar se não existir; senão anexar)

O `date-range.ts` já resolve calendário em `America/Sao_Paulo`. Adicione dois helpers puros que a recorrência usa: o rótulo `"YYYY-MM"` do mês corrente e a data de vencimento de um `dayOfMonth` **clampada** ao último dia do mês.

**Step 1: Teste que falha**

```ts
// src/server/services/date-range.test.ts
import { describe, it, expect } from "vitest";
import { competenceMonth, dueDateForDayOfMonth } from "./date-range";

describe("competenceMonth", () => {
  it("rotula o mês local como YYYY-MM", () => {
    // 2026-07-04 12:00 BRT
    expect(competenceMonth(new Date("2026-07-04T15:00:00Z"))).toBe("2026-07");
  });
});

describe("dueDateForDayOfMonth", () => {
  it("usa o dia pedido dentro do mês", () => {
    const d = dueDateForDayOfMonth("2026-07", 5);
    // 2026-07-05 no fuso local
    expect(d.toISOString().slice(0, 10)).toBe("2026-07-05");
  });
  it("clampa ao último dia em mês curto (fev, dia 31)", () => {
    const d = dueDateForDayOfMonth("2026-02", 31);
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
```

> As asserções por `toISOString().slice(0,10)` assumem vencimento fixado ao **meio-dia local** (12:00 BRT = 15:00Z), o que mantém a data-calendário estável e longe da borda de dia. Implemente assim.

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/date-range.test.ts`
Expected: FAIL — funções inexistentes.

**Step 3: Implementar** (anexar ao fim de `date-range.ts`, reusando `tzParts`/o padrão de fuso já no arquivo):

```ts
/** Rótulo "YYYY-MM" do mês corrente no fuso do projeto. */
export function competenceMonth(now = new Date()): string {
  const { year, month } = tzParts(now, TZ);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Vencimento de um dia-do-mês, clampado ao último dia, fixado ao meio-dia local. */
export function dueDateForDayOfMonth(competence: string, dayOfMonth: number): Date {
  const [y, m] = competence.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // dia 0 do próximo mês = último deste
  const day = Math.min(Math.max(1, Math.floor(dayOfMonth)), lastDay);
  // meio-dia BRT (-03:00) → 15:00Z; estável longe da borda de dia
  return new Date(`${competence}-${String(day).padStart(2, "0")}T12:00:00-03:00`);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/date-range.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/date-range.ts src/server/services/date-range.test.ts
git commit -m "feat(caixa): helpers competenceMonth/dueDateForDayOfMonth (mês e vencimento no fuso)"
```

---

# FASE 1 — Serviço de despesas (o coração)

## Task 1.1: `expense.service` — CRUD, pagar, listar (com teste)

**Files:**
- Create: `src/server/services/expense.service.ts`
- Test: `src/server/services/expense.service.test.ts`

Regras: escopo por `accountId`; `description` obrigatória; `amountCents` inteiro ≥ 0; `dueDate` obrigatória; `category` do enum (default `OUTRO`). `createExpense` pode nascer já PAGA (`paidAt`) para o caso "paguei agora". `payExpense` marca PAGA + `paidAt = now`. Listagem separa **a pagar** (PENDENTE, por vencimento asc) de **pagas** (por `paidAt` desc).

**Step 1: Teste que falha**

```ts
// src/server/services/expense.service.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createExpense, listPayable, listPaid, payExpense, updateExpense, deleteExpense,
} from "./expense.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `exp_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("expense.service", () => {
  it("cria conta a pagar (pendente) e lista escopado", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createExpense(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dueDate: "2026-07-05", createdById: a });
    await createExpense(b, { description: "Luz", amountCents: 20000, category: "CONTAS", dueDate: "2026-07-10", createdById: b });
    const payA = await listPayable(a);
    expect(payA).toHaveLength(1);
    expect(payA[0].description).toBe("Aluguel");
    expect(payA[0].status).toBe("PENDENTE");
  });

  it("rejeita descrição vazia e valor negativo", async () => {
    const a = await makeOwner();
    await expect(createExpense(a, { description: "  ", amountCents: 100, dueDate: "2026-07-01", createdById: a })).rejects.toThrow();
    await expect(createExpense(a, { description: "X", amountCents: -1, dueDate: "2026-07-01", createdById: a })).rejects.toThrow();
  });

  it("nasce já paga quando paidNow=true", async () => {
    const a = await makeOwner();
    const e = await createExpense(a, { description: "Material", amountCents: 5000, dueDate: "2026-07-04", createdById: a, paidNow: true });
    expect(e.status).toBe("PAGA");
    expect(e.paidAt).toBeTruthy();
    expect(await listPayable(a)).toHaveLength(0);
    expect((await listPaid(a)).map((x) => x.id)).toContain(e.id);
  });

  it("payExpense marca paga e sai da lista de a pagar", async () => {
    const a = await makeOwner();
    const e = await createExpense(a, { description: "Fornecedor", amountCents: 30000, dueDate: "2026-07-08", createdById: a });
    const paid = await payExpense(a, e.id);
    expect(paid.status).toBe("PAGA");
    expect(paid.paidAt).toBeTruthy();
    expect(await listPayable(a)).toHaveLength(0);
  });

  it("não deixa outra conta pagar/editar/excluir", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const e = await createExpense(a, { description: "X", amountCents: 100, dueDate: "2026-07-01", createdById: a });
    await expect(payExpense(b, e.id)).rejects.toThrow();
    await expect(updateExpense(b, e.id, { amountCents: 1 })).rejects.toThrow();
    await expect(deleteExpense(b, e.id)).rejects.toThrow();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```ts
// src/server/services/expense.service.ts
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { ExpenseCategory, ExpenseStatus } from "@prisma/client";

export interface ExpenseDTO {
  id: string;
  description: string;
  amountCents: number;
  category: ExpenseCategory;
  status: ExpenseStatus;
  dueDate: string;
  paidAt: string | null;
  note: string | null;
  recurringId: string | null;
}

const CATEGORIES = ["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"] as const;

const createSchema = z.object({
  description: z.string().trim().min(1, "Descrição obrigatória."),
  amountCents: z.number().int().min(0, "Valor não pode ser negativo."),
  category: z.enum(CATEGORIES).default("OUTRO"),
  dueDate: z.string().min(1, "Vencimento obrigatório."), // "YYYY-MM-DD"
  note: z.string().trim().optional(),
});

/** "YYYY-MM-DD" → Date ao meio-dia local (estável longe da borda de dia). */
function parseDueDate(s: string): Date {
  const d = new Date(`${s}T12:00:00-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Data de vencimento inválida.");
  return d;
}

function toDTO(o: {
  id: string; description: string; amountCents: number; category: ExpenseCategory;
  status: ExpenseStatus; dueDate: Date; paidAt: Date | null; note: string | null; recurringId: string | null;
}): ExpenseDTO {
  return {
    id: o.id, description: o.description, amountCents: o.amountCents, category: o.category,
    status: o.status, dueDate: o.dueDate.toISOString(), paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    note: o.note, recurringId: o.recurringId,
  };
}

export async function createExpense(
  accountId: string,
  data: { description: string; amountCents: number; category?: ExpenseCategory; dueDate: string; note?: string; createdById: string; paidNow?: boolean },
): Promise<ExpenseDTO> {
  const parsed = createSchema.parse(data);
  const e = await prisma.expense.create({
    data: {
      accountId,
      description: parsed.description,
      amountCents: parsed.amountCents,
      category: parsed.category,
      dueDate: parseDueDate(parsed.dueDate),
      note: parsed.note || null,
      createdById: data.createdById,
      status: data.paidNow ? "PAGA" : "PENDENTE",
      paidAt: data.paidNow ? new Date() : null,
    },
  });
  return toDTO(e);
}

export async function listPayable(accountId: string): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: { accountId, status: "PENDENTE" },
    orderBy: { dueDate: "asc" },
  });
  return rows.map(toDTO);
}

export async function listPaid(accountId: string, limit = 100): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: { accountId, status: "PAGA" },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
  return rows.map(toDTO);
}

async function loadOwned(accountId: string, id: string) {
  const e = await prisma.expense.findFirst({ where: { id, accountId } });
  if (!e) throw new Error("Despesa não encontrada.");
  return e;
}

export async function payExpense(accountId: string, id: string): Promise<ExpenseDTO> {
  const owned = await loadOwned(accountId, id);
  if (owned.status === "PAGA") throw new Error("Despesa já está paga."); // não re-escreve paidAt
  const e = await prisma.expense.update({ where: { id }, data: { status: "PAGA", paidAt: new Date() } });
  return toDTO(e);
}

export async function updateExpense(
  accountId: string,
  id: string,
  data: { description?: string; amountCents?: number; category?: ExpenseCategory; dueDate?: string; note?: string | null },
): Promise<ExpenseDTO> {
  await loadOwned(accountId, id);
  const patch: Record<string, unknown> = {};
  if (data.description !== undefined) {
    const d = data.description.trim();
    if (!d) throw new Error("Descrição obrigatória.");
    patch.description = d;
  }
  if (data.amountCents !== undefined) {
    if (!Number.isInteger(data.amountCents) || data.amountCents < 0) throw new Error("Valor inválido.");
    patch.amountCents = data.amountCents;
  }
  if (data.category !== undefined) patch.category = data.category;
  if (data.dueDate !== undefined) patch.dueDate = parseDueDate(data.dueDate);
  if (data.note !== undefined) patch.note = data.note?.trim() || null;
  const e = await prisma.expense.update({ where: { id }, data: patch });
  return toDTO(e);
}

export async function deleteExpense(accountId: string, id: string): Promise<void> {
  await loadOwned(accountId, id);
  await prisma.expense.delete({ where: { id } });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/expense.service.ts src/server/services/expense.service.test.ts
git commit -m "feat(caixa): expense.service (CRUD de despesa, marcar paga, a pagar/pagas)"
```

---

## Task 1.2: Recorrência — CRUD + materialização idempotente (com teste)

**Files:**
- Modify: `src/server/services/expense.service.ts` (adicionar recorrentes + `ensureRecurringForMonth`)
- Modify: `src/server/services/expense.service.test.ts` (adicionar bloco de recorrência)

`ensureRecurringForMonth(accountId, competence)` materializa, para cada `RecurringExpense` **ativa**, uma `Expense` PENDENTE do mês (se ainda não existir). Idempotente via `upsert` na chave `recurringId + competenceMonth`. Editar/desativar o template **não** mexe em instâncias já geradas.

**Step 1: Teste que falha** (anexar ao describe existente ou novo):

```ts
// ...adicionar imports:
import { createRecurring, listRecurring, updateRecurring, deleteRecurring, ensureRecurringForMonth } from "./expense.service";

describe("expense.service — recorrência", () => {
  it("gera 1 despesa por mês, idempotente, e clampa o vencimento", async () => {
    const a = await makeOwner();
    await createRecurring(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dayOfMonth: 31, createdById: a });

    const gen1 = await ensureRecurringForMonth(a, "2026-02");
    expect(gen1).toBe(1); // 1 criada
    const pay = await listPayable(a);
    expect(pay).toHaveLength(1);
    expect(pay[0].description).toBe("Aluguel");
    expect(pay[0].dueDate.slice(0, 10)).toBe("2026-02-28"); // clamp de fev

    const gen2 = await ensureRecurringForMonth(a, "2026-02");
    expect(gen2).toBe(0); // idempotente — não duplica
    expect(await listPayable(a)).toHaveLength(1);
  });

  it("template inativo não gera", async () => {
    const a = await makeOwner();
    const r = await createRecurring(a, { description: "Net", amountCents: 10000, category: "CONTAS", dayOfMonth: 10, createdById: a });
    await updateRecurring(a, r.id, { active: false });
    expect(await ensureRecurringForMonth(a, "2026-07")).toBe(0);
    expect(await listPayable(a)).toHaveLength(0);
  });

  it("recorrentes escopados por conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const r = await createRecurring(a, { description: "X", amountCents: 100, dayOfMonth: 5, createdById: a });
    await expect(updateRecurring(b, r.id, { amountCents: 1 })).rejects.toThrow();
    await expect(deleteRecurring(b, r.id)).rejects.toThrow();
    expect(await listRecurring(a)).toHaveLength(1);
    expect(await listRecurring(b)).toHaveLength(0);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: FAIL — funções inexistentes.

**Step 3: Implementar** (adicionar ao `expense.service.ts`; os dois `import` abaixo vão **no topo do arquivo**, junto dos imports existentes — não no meio do corpo):

```ts
import { dueDateForDayOfMonth } from "./date-range";
import type { RecurringExpense } from "@prisma/client";

export interface RecurringDTO {
  id: string; description: string; amountCents: number; category: ExpenseCategory; dayOfMonth: number; active: boolean;
}

const recurringSchema = z.object({
  description: z.string().trim().min(1, "Descrição obrigatória."),
  amountCents: z.number().int().min(0, "Valor não pode ser negativo."),
  category: z.enum(CATEGORIES).default("OUTRO"),
  dayOfMonth: z.number().int().min(1).max(31),
});

function recToDTO(r: RecurringExpense): RecurringDTO {
  return { id: r.id, description: r.description, amountCents: r.amountCents, category: r.category, dayOfMonth: r.dayOfMonth, active: r.active };
}

export async function createRecurring(
  accountId: string,
  data: { description: string; amountCents: number; category?: ExpenseCategory; dayOfMonth: number; createdById: string },
): Promise<RecurringDTO> {
  const parsed = recurringSchema.parse(data);
  const r = await prisma.recurringExpense.create({ data: { accountId, createdById: data.createdById, ...parsed } });
  return recToDTO(r);
}

export async function listRecurring(accountId: string): Promise<RecurringDTO[]> {
  const rows = await prisma.recurringExpense.findMany({
    where: { accountId },
    orderBy: [{ active: "desc" }, { description: "asc" }],
  });
  return rows.map(recToDTO);
}

export async function updateRecurring(
  accountId: string,
  id: string,
  data: { description?: string; amountCents?: number; category?: ExpenseCategory; dayOfMonth?: number; active?: boolean },
): Promise<RecurringDTO> {
  const owned = await prisma.recurringExpense.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Despesa fixa não encontrada.");
  const patch: Record<string, unknown> = {};
  if (data.description !== undefined) {
    const d = data.description.trim();
    if (!d) throw new Error("Descrição obrigatória.");
    patch.description = d;
  }
  if (data.amountCents !== undefined) {
    if (!Number.isInteger(data.amountCents) || data.amountCents < 0) throw new Error("Valor inválido.");
    patch.amountCents = data.amountCents;
  }
  if (data.category !== undefined) patch.category = data.category;
  if (data.dayOfMonth !== undefined) {
    if (!Number.isInteger(data.dayOfMonth) || data.dayOfMonth < 1 || data.dayOfMonth > 31) throw new Error("Dia inválido.");
    patch.dayOfMonth = data.dayOfMonth;
  }
  if (data.active !== undefined) patch.active = data.active;
  const r = await prisma.recurringExpense.update({ where: { id }, data: patch });
  return recToDTO(r);
}

export async function deleteRecurring(accountId: string, id: string): Promise<void> {
  const owned = await prisma.recurringExpense.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Despesa fixa não encontrada.");
  await prisma.recurringExpense.delete({ where: { id } }); // Expenses geradas ficam (recurringId → SetNull)
}

/**
 * Materializa as despesas fixas ativas da conta no mês `competence` ("YYYY-MM").
 * Idempotente: a chave única (recurringId, competenceMonth) evita duplicata.
 * Retorna quantas foram criadas nesta chamada.
 */
export async function ensureRecurringForMonth(accountId: string, competence: string): Promise<number> {
  const actives = await prisma.recurringExpense.findMany({ where: { accountId, active: true } });
  let created = 0;
  for (const r of actives) {
    const exists = await prisma.expense.findFirst({
      where: { recurringId: r.id, competenceMonth: competence },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.expense.create({
      data: {
        accountId,
        description: r.description,
        amountCents: r.amountCents,
        category: r.category,
        status: "PENDENTE",
        dueDate: dueDateForDayOfMonth(competence, r.dayOfMonth),
        createdById: r.createdById,
        recurringId: r.id,
        competenceMonth: competence,
      },
    });
    created++;
  }
  return created;
}
```

> **Nota de concorrência:** o `findFirst`+`create` tem uma janela de corrida teórica (dois GETs simultâneos no mesmo mês). A chave única `@@unique([recurringId, competenceMonth])` é a rede de segurança — o 2º `create` falha com P2002. Para o volume de um negócio pequeno isso é aceitável; se quiser blindar, troque por `upsert` na chave composta.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: PASS (todos).

**Step 5: Commit**

```bash
git add src/server/services/expense.service.ts src/server/services/expense.service.test.ts
git commit -m "feat(caixa): despesas fixas (recorrência) com materialização mensal idempotente"
```

---

# FASE 2 — API de despesas

## Task 2.1: API de despesas (list/create/pay/edit/delete)

**Files:**
- Create: `src/app/api/vendas/expenses/route.ts` (GET lista a-pagar+pagas — gera recorrentes do mês antes; POST cria)
- Create: `src/app/api/vendas/expenses/[id]/route.ts` (PATCH edita, DELETE)
- Create: `src/app/api/vendas/expenses/[id]/pay/route.ts` (POST marca paga)

> Namespace `/api/vendas/*` mantido de propósito (rename é só da superfície visível — ver decisões). Confirme a assinatura de `params` (Promise) numa rota `[id]` existente: `src/app/api/vendas/orders/[id]/route.ts`.

**Step 1: `route.ts`**

```ts
// src/app/api/vendas/expenses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { competenceMonth } from "@/server/services/date-range";
import { createExpense, listPayable, listPaid, ensureRecurringForMonth } from "@/server/services/expense.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  // Garante as fixas do mês corrente antes de listar (lazy, idempotente).
  await ensureRecurringForMonth(ctx.tenantUserId, competenceMonth());
  const [payable, paid] = await Promise.all([listPayable(ctx.tenantUserId), listPaid(ctx.tenantUserId)]);
  return NextResponse.json({ payable, paid });
}

const createSchema = z.object({
  description: z.string(),
  amountCents: z.number().int(),
  category: z.enum(["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"]).optional(),
  dueDate: z.string(),
  note: z.string().optional(),
  paidNow: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const expense = await createExpense(ctx.tenantUserId, { ...parsed.data, createdById: ctx.sessionUserId });
    return NextResponse.json({ expense });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
```

**Step 2: `[id]/route.ts`** (PATCH/DELETE) e **`[id]/pay/route.ts`** (POST) — mesmos padrões (401/403 canSettings, zod, `try/catch → {error}`), chamando `updateExpense`/`deleteExpense`/`payExpense`. PATCH usa:

```ts
const patchSchema = z.object({
  description: z.string().optional(),
  amountCents: z.number().int().optional(),
  category: z.enum(["ALUGUEL","FORNECEDOR","PESSOAL","CONTAS","IMPOSTOS","OUTRO"]).optional(),
  dueDate: z.string().optional(),
  note: z.string().nullish(),
});
```

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/app/api/vendas/expenses
git commit -m "feat(caixa): API de despesas (list+gera fixas/create/pay/patch/delete)"
```

---

## Task 2.2: API de despesas fixas (recorrentes)

**Files:**
- Create: `src/app/api/vendas/expenses/recurring/route.ts` (GET lista, POST cria)
- Create: `src/app/api/vendas/expenses/recurring/[id]/route.ts` (PATCH, DELETE)

Mesmos padrões (401/403 `canSettings`, zod, `try/catch`), chamando `listRecurring`/`createRecurring`/`updateRecurring`/`deleteRecurring`. `createRecurring` recebe `createdById: ctx.sessionUserId`. Corpo de criação: `{ description, amountCents, category?, dayOfMonth }`; PATCH adiciona `active?: boolean`.

**Step 1:** implementar as duas rotas.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/vendas/expenses/recurring
git commit -m "feat(caixa): API de despesas fixas (recorrentes: list/create/patch/delete)"
```

---

# FASE 3 — Relatório: despesas e saldo

## Task 3.1: `expense-report.service` (com teste)

**Files:**
- Create: `src/server/services/expense-report.service.ts`
- Test: `src/server/services/expense-report.service.test.ts`

Agrega despesas **PAGAS** por `paidAt` no período (regime de caixa, casando com o faturamento por `closedAt`). Duas saídas: total de despesas e total por categoria. (O saldo é montado na rota, subtraindo do faturamento — não duplica lógica.)

**Step 1: Teste que falha**

```ts
// src/server/services/expense-report.service.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createExpense, payExpense } from "./expense.service";
import { expensesTotal, expensesByCategory } from "./expense-report.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `erep_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}

describe("expense-report.service", () => {
  it("soma só despesas pagas no período, por categoria", async () => {
    const a = await makeOwner();
    const e1 = await createExpense(a, { description: "Aluguel", amountCents: 150000, category: "ALUGUEL", dueDate: "2026-07-05", createdById: a });
    await payExpense(a, e1.id); // paidAt = agora (dentro do período)
    const e2 = await createExpense(a, { description: "Luz", amountCents: 20000, category: "CONTAS", dueDate: "2026-07-10", createdById: a });
    await payExpense(a, e2.id);
    await createExpense(a, { description: "Água", amountCents: 9000, category: "CONTAS", dueDate: "2026-07-11", createdById: a }); // PENDENTE — não conta

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    expect(await expensesTotal(a, from, to)).toBe(170000);

    const byCat = await expensesByCategory(a, from, to);
    expect(byCat.find((c) => c.category === "ALUGUEL")?.totalCents).toBe(150000);
    expect(byCat.find((c) => c.category === "CONTAS")?.totalCents).toBe(20000);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/expense-report.service.test.ts`
Expected: FAIL.

**Step 3: Implementar**

```ts
// src/server/services/expense-report.service.ts
import { prisma } from "@/server/db/client";
import type { ExpenseCategory } from "@prisma/client";

export async function expensesTotal(accountId: string, from: Date, to: Date): Promise<number> {
  const agg = await prisma.expense.aggregate({
    where: { accountId, status: "PAGA", paidAt: { gte: from, lte: to } },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

export async function expensesByCategory(accountId: string, from: Date, to: Date): Promise<{ category: ExpenseCategory; totalCents: number }[]> {
  const rows = await prisma.expense.groupBy({
    by: ["category"],
    where: { accountId, status: "PAGA", paidAt: { gte: from, lte: to } },
    _sum: { amountCents: true },
  });
  return rows
    .map((r) => ({ category: r.category, totalCents: r._sum.amountCents ?? 0 }))
    .sort((a, b) => b.totalCents - a.totalCents);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/expense-report.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/expense-report.service.ts src/server/services/expense-report.service.test.ts
git commit -m "feat(caixa): expense-report.service (despesas pagas e por categoria no período)"
```

---

## Task 3.2: Estender a rota de reports com despesas + saldo

**Files:**
- Modify: `src/app/api/vendas/reports/route.ts`

**Step 1:** manter o faturamento visível como hoje e **incluir despesas/saldo SÓ para quem tem `canSettings`** — senão um operador (que nem vê a aba Despesas) receberia os números da empresa pela API. A rota continua 401 sem sessão, mas **não** vira 403 geral (operador ainda vê vendas):

```ts
import { expensesTotal, expensesByCategory } from "@/server/services/expense-report.service";
// ...dentro do GET, após resolvePeriod:
const [summary, byPayment, byOperator, top] = await Promise.all([
  salesSummary(ctx.tenantUserId, from, to),
  revenueByPayment(ctx.tenantUserId, from, to),
  revenueByOperator(ctx.tenantUserId, from, to),
  topItems(ctx.tenantUserId, from, to, 10),
]);

const base = { period, summary, byPayment, byOperator, topItems: top };
// Despesas/saldo são de DONO. Operador recebe só as vendas (sem os campos de despesa).
if (!ctx.perms.canSettings) return NextResponse.json(base);

const [expTotal, expByCat] = await Promise.all([
  expensesTotal(ctx.tenantUserId, from, to),
  expensesByCategory(ctx.tenantUserId, from, to),
]);
return NextResponse.json({
  ...base,
  expensesTotalCents: expTotal,
  expensesByCategory: expByCat,
  balanceCents: summary.totalCents - expTotal,
});
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/vendas/reports/route.ts
git commit -m "feat(caixa): relatório inclui despesas pagas, por categoria e saldo do período"
```

---

## Task 3.3: Rótulos de categoria (compartilhados)

**Files:**
- Create: `src/components/vendas/expense-labels.ts`

Espelha `payment-labels.ts` (já existente) — rótulos PT-BR do enum, usados pelo relatório (Task 3.4) e pela aba (Task 4.1). Criado aqui porque o ReportsPanel é o primeiro consumidor.

```ts
// src/components/vendas/expense-labels.ts
import type { ExpenseCategory } from "@prisma/client";

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  ALUGUEL: "Aluguel",
  FORNECEDOR: "Fornecedor / Mercadoria",
  PESSOAL: "Salário / Pessoal",
  CONTAS: "Contas (luz/água/net)",
  IMPOSTOS: "Impostos / Taxas",
  OUTRO: "Outro",
};

export const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] =
  (Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).map((value) => ({ value, label: CATEGORY_LABEL[value] }));
```

**Commit:**

```bash
git add src/components/vendas/expense-labels.ts
git commit -m "feat(caixa): rótulos PT-BR das categorias de despesa"
```

---

## Task 3.4: UI — cards de Despesas/Saldo no ReportsPanel

**Files:**
- Modify: `src/components/vendas/ReportsPanel.tsx`

**Step 1:** estender `ReportData` e o grid de cards. **Os campos de despesa são opcionais** — o operador (sem `canSettings`) não os recebe (Task 3.2), então renderize os cards de despesa **só quando presentes**.

- Amplie a interface com campos **opcionais**: `expensesTotalCents?: number; balanceCents?: number; expensesByCategory?: { category: string; totalCents: number }[];`
- `const hasExpenses = data?.expensesTotalCents !== undefined;`
- Grid de cards: **quando `hasExpenses`**, use `sm:grid-cols-2 lg:grid-cols-4` com **Faturamento · Despesas · Saldo · Ticket médio**; **senão** mantenha o layout atual `sm:grid-cols-3` (Faturamento · Comandas · Ticket médio). Para o Saldo, renderize o valor com classe condicional `(data.balanceCents ?? 0) < 0 ? "text-red-600" : "text-ink"`.
- Adicione um `Card` "Despesas por categoria" (espelhando "Por forma de pagamento"), **só quando `hasExpenses`**, usando `CATEGORY_LABEL` de `./expense-labels` (Task 3.3) e `formatCentsBRL`.

**Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros. (Render real na verificação E2E.)

**Step 3: Commit**

```bash
git add src/components/vendas/ReportsPanel.tsx
git commit -m "feat(caixa): cards de Despesas/Saldo e por categoria no relatório"
```

---

# FASE 4 — Aba Despesas, rename para Caixa e E2E

## Task 4.1: UI — painel de Despesas (aba)

**Files:**
- Create: `src/components/vendas/ExpensesPanel.tsx`

Client component (padrão visual de `CatalogManager`/`ReportsPanel`). Estrutura (esboço — siga `Card`/`Button`, `formatCentsBRL`/`parseBRLToCents`, `CATEGORY_OPTIONS`):

- **Seção "A pagar"**: lista `payable` (de `GET /api/vendas/expenses`) ordenada por vencimento; **vencidas** (dueDate < hoje) destacadas em vermelho; cada linha tem "Marcar paga" (`POST /api/vendas/expenses/:id/pay`) e excluir. Mostra um total "a pagar".
- **Form "Nova despesa"**: descrição, valor (`parseBRLToCents`), categoria (select `CATEGORY_OPTIONS`), vencimento (`<input type="date">`), checkbox "já paguei" (→ `paidNow`). `POST /api/vendas/expenses`.
- **Seção "Pagas"** (recolhível): `paid` mais recentes.
- **Seção "Despesas fixas"**: CRUD de recorrentes (`/api/vendas/expenses/recurring`) — descrição, valor, categoria, **dia do vencimento** (1..31), toggle ativo. Texto de ajuda: "Geramos a conta todo mês automaticamente; marque como paga quando pagar."

Cada ação re-`fetch`a a lista. Erros mostram `d.error` (nunca silencioso).

**Step 2: Verificar** — montado na Task 4.2. `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/vendas/ExpensesPanel.tsx
git commit -m "feat(caixa): UI do painel de despesas (a pagar, pagas, fixas)"
```

---

## Task 4.2: Aba "Despesas" no workspace + rename para Caixa

**Files:**
- Modify: `src/components/vendas/VendasWorkspace.tsx` (aba nova, gated por `canEdit`)
- Rename (mover pasta): `src/app/(app)/vendas/` → `src/app/(app)/caixa/` + ajustar títulos
- Create: `src/app/(app)/vendas/page.tsx` (redirect `/vendas` → `/caixa`, pra bookmarks antigos)
- Modify: `src/components/app/Sidebar.tsx:122` (nav `/vendas` → `/caixa`, label "Vendas" → "Caixa")

**Step 1: Aba Despesas** em `VendasWorkspace.tsx` — só aparece com `canEdit` (despesa é do dono):

```tsx
import { ExpensesPanel } from "./ExpensesPanel";
type Tab = "comandas" | "catalogo" | "despesas" | "relatorios";
// TABS: inclua { value: "despesas", label: "Despesas" } SÓ quando canEdit:
const tabs = [
  { value: "comandas", label: "Comandas" },
  { value: "catalogo", label: "Catálogo" },
  ...(canEdit ? [{ value: "despesas", label: "Despesas" } as const] : []),
  { value: "relatorios", label: "Relatórios" },
];
// ...no corpo: {tab === "despesas" && <ExpensesPanel />}
```

> Se `canEdit` for falso, garanta que `tab` nunca fique preso em `"despesas"` (default é `"comandas"`, então ok).

**Step 2: Mover a página** `src/app/(app)/vendas/page.tsx` → `src/app/(app)/caixa/page.tsx` (via `git mv`). Ajuste o header e o subtítulo:

```tsx
// título: "Caixa"
// subtítulo: "Registre vendas e despesas do dia, gerencie catálogo e acompanhe o saldo."
```

**Step 3: Redirect** do caminho antigo — novo `src/app/(app)/vendas/page.tsx`:

```tsx
import { redirect } from "next/navigation";
export default function VendasRedirect() {
  redirect("/caixa");
}
```

**Step 4: Navegação** — `src/components/app/Sidebar.tsx:122`:

```tsx
        { href: "/caixa", label: "Caixa", icon: Receipt },
```

(Mantém o ícone `Receipt`; `Wallet` já é do `/financeiro` admin.)

**Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 6: Commit**

```bash
git add "src/app/(app)/caixa" "src/app/(app)/vendas" src/components/vendas/VendasWorkspace.tsx src/components/app/Sidebar.tsx
git commit -m "feat(caixa): aba Despesas + rename do módulo Vendas→Caixa (rota /caixa + redirect)"
```

---

## Task 4.3: Verificação end-to-end (manual)

Use a skill @verify. Run: `npm run dev`.

**Checklist:**
- [ ] `/vendas` redireciona para `/caixa`; a navegação mostra "Caixa".
- [ ] Abas: Comandas · Catálogo · **Despesas** · Relatórios (Despesas só para quem tem `canSettings`).
- [ ] **Despesa avulsa:** nova "Material R$50", categoria Fornecedor, vencimento hoje, "já paguei" → some de "A pagar", aparece em "Pagas".
- [ ] **Conta a pagar:** nova "Luz R$120" vencimento futuro (PENDENTE) → aparece em "A pagar"; "Marcar paga" → vai pra Pagas.
- [ ] **Vencida:** conta com vencimento passado aparece destacada (vermelho).
- [ ] **Despesa fixa:** criar "Aluguel R$1500, dia 5" → recarregar a aba gera a conta do mês em "A pagar" (uma vez só; recarregar de novo NÃO duplica).
- [ ] **Relatório:** com uma comanda fechada e despesas pagas no período, os cards mostram Faturamento, Despesas, **Saldo** (= faturamento − despesas; vermelho se negativo) e "Despesas por categoria" coerentes.
- [ ] **Permissão:** operador sem `canSettings` não vê a aba Despesas; `GET/POST /api/vendas/expenses` direto retorna 403.
- [ ] **Sem vazamento:** logado como operador, `GET /api/vendas/reports` responde 200 **sem** `expensesTotalCents`/`balanceCents`/`expensesByCategory`; o relatório mostra só os cards de vendas.
- [ ] `npx vitest run` (verde) e `npx tsc --noEmit` (limpo).

---

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde.
- [ ] `npx tsc --noEmit` — limpo.
- [ ] Dinheiro sempre em centavos; UI formata com `formatCentsBRL`.
- [ ] Todo dado escopado por `accountId`; nenhuma query cruza tenant.
- [ ] Despesas gated por `canSettings` (aba + todas as rotas de API).
- [ ] Saldo = faturamento (`closedAt`) − despesas **pagas** (`paidAt`), mesmo regime de caixa.

**Notas de produção (para o dono aplicar):**
- Aplicar `prisma/manual/2026-07-04-caixa-despesas.sql` no Supabase SQL Editor de **prod** ANTES de usar (a aba quebra sem as tabelas). Validar com `select to_regclass('public."Expense"'), to_regclass('public."RecurringExpense"');`.
- Deploy pela CLI da Vercel (memória `vercel-hobby-push-block`).
- Sem mudança no worker: a geração de fixas é lazy no GET da aba (não depende do Oracle).

**Fora de escopo (v2, sob demanda):** forma de pagamento da despesa; anexo de comprovante; recorrência não-mensal; backfill de meses passados; alerta/lembrete de vencimento (poderia reusar o worker da agenda); relatório de fluxo projetado (a vencer no mês); categorias cadastráveis; renomear pastas internas (`components/vendas/`, `/api/vendas/*`) para `caixa`.
```
