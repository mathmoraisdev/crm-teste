# Controle de Estoque Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar aos negócios que vendem **produto físico** (varejo de produto e também serviço-com-revenda, ex.: barbearia que vende pomada/óleo/shampoo) um **controle de estoque** simples e opt-in: cadastrar quantidade e SKU nos itens de catálogo do tipo `PRODUTO`, **dar baixa automática quando a comanda fecha**, registrar **entradas/ajustes** manuais, e ver **o que está acabando** (estoque ≤ mínimo). Tudo dentro do módulo Caixa, sem tocar em quem só vende serviço.

**Architecture:** Estende `CatalogItem` (que já tem `kind = PRODUTO`) com campos de estoque **opt-in** (`trackStock`, `sku`, `stockQty`, `minStock`, `costCents`) — quem não liga `trackStock` nunca vê nada disso. Um modelo novo `StockMovement` é o **livro-razão imutável** de toda variação (ENTRADA / SAIDA / AJUSTE), com `delta` e `balanceAfter` (snapshot), espelhando o padrão do ledger `Payment`. O `stockQty` fica **desnormalizado** no `CatalogItem` (lido o tempo todo: catálogo, comanda) e é mantido **transacionalmente** junto de cada movimento, usando `increment`/`decrement` atômicos do Postgres. A **baixa de venda** acontece **no fechamento da comanda** (mesmo momento em que a venda "conta" — `closedAt`), dentro de uma transação: para cada linha ligada a um produto rastreado, cria um `SAIDA` e decrementa. **Não bloqueia a venda** se faltar estoque (nunca travar dinheiro) — deixa o saldo ficar negativo e sinaliza. Reaproveita `catalog.service`, `order.service`, `getTenantContext`, `money.ts` e os componentes do Caixa.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma + Postgres · Zod · TailwindCSS · Vitest (`*.test.ts` co-locado).

**Escopo (o que NÃO entra na v1):** variação/grade de produto (produto→variantes; cada tamanho/cor é uma **linha própria** no catálogo — SKU flat); venda por peso/fração (segue `quantity Int`); custo médio ponderado / valorização de estoque avançada (guarda `costCents` unitário simples); bloqueio de venda por falta de estoque (permite negativo por decisão); reserva de estoque em comanda **aberta** (baixa só no fechamento); reabrir comanda fechada e estornar a baixa (reabertura já é fora de escopo do módulo); unicidade de SKU (campo livre por ora); código de barras/leitor.

**Decisões de produto (mesma linha do Caixa):**
- **Opt-in por item.** Só produto com `trackStock = true` entra no controle. Barbearia liga em "Pomada", não em "Corte". Serviço nunca tem estoque. Mantém o "entra em todos os planos" sem poluir os ~50 modelos de serviço.
- **Baixa no fechamento**, não ao adicionar o item (comanda aberta não mexe em estoque; some/refaz linha à vontade).
- **Não trava a venda.** Faltou estoque no fechamento? Vende, estoque fica negativo, aparece no alerta como "conferir". Dinheiro nunca é bloqueado por contagem de estoque.
- **Estoque é de dono/gerente.** Cadastrar controle, dar entrada e ajustar exigem `canSettings` (igual editar catálogo). Registrar comanda (que dispara a baixa automática) **não** exige — a baixa é server-side.

---

## ⚠️ Coordenação com o plano de Despesas (execução paralela)

O plano `docs/plans/2026-07-04-caixa-despesas-contas-a-pagar.md` está sendo executado **em paralelo, em outro chat**. Os dois módulos são independentes, mas **encostam em 2 arquivos** — trate como merge cuidadoso, não como conflito de conteúdo:

- **`prisma/schema.prisma`** — ambos adicionam models novos e relações inversas no `model User`. São blocos diferentes (Expense/RecurringExpense vs StockMovement) e **compõem**; só garanta que as duas listas de relações convivam no `User`. Rode `npx prisma validate` depois de integrar.
- **`src/components/vendas/VendasWorkspace.tsx`** — o de despesas adiciona a aba **"Despesas"**; este adiciona **"Estoque"**. A lista final de abas deve conter as duas (ambas gated por `canEdit`). Se um plano já mexeu no arquivo, **acrescente** sua aba à lista existente em vez de sobrescrever.

Fora esses dois, não há sobreposição. Este plano **não toca** na rota de reports nem no `ReportsPanel` (o de despesas toca) — de propósito, pra não colidir. O rename `/vendas`→`/caixa` (do plano de despesas) é só da rota da página; os componentes seguem em `src/components/vendas/` — os caminhos deste plano usam essa pasta e permanecem válidos independente do rename.

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest, co-locado. Os `*.service.test.ts` tocam o banco de dev e criam um dono descartável por teste (padrão de `catalog.service.test.ts`). Rodar um: `npx vitest run caminho/arquivo.test.ts`.
- **Schema:** dev usa `npx prisma db push`. **Produção** tem cutover pendente p/ `migrate deploy` — NÃO rode migrate em prod. Cada mudança ganha SQL manual idempotente em `prisma/manual/` (padrão de `2026-07-03-vendas.sql`), aplicado no Supabase SQL Editor pelo dono.
- **Dinheiro:** centavos (`Int`). `parseBRLToCents`/`formatCentsBRL` de `src/lib/money.ts` só na borda. **Quantidade de estoque é `Int`** (unidades inteiras).
- **Tenancy:** dono = `ctx.tenantUserId`; operador = `ctx.sessionUserId`. Tudo escopado por `accountId = ctx.tenantUserId`.
- **Rotas de API:** espelhe `src/app/api/vendas/catalog/[id]/route.ts` — `dynamic = "force-dynamic"`, `getTenantContext()`, 401 sem sessão, **403 sem `canSettings`**, zod, `try/catch → { error }` legível.
- **Prisma no Windows:** se `db push`/`generate` der EPERM, pare o `next dev` antes (memória `prisma-generate-dev-server-lock`).
- **Commits frequentes** ao fim de cada task.

---

## Visão geral das fases

- **Fase 0** — Schema: campos de estoque em `CatalogItem` + model `StockMovement` + enum + relações. push dev + SQL manual.
- **Fase 1** — `catalog.service` estendido (config de estoque, TDD) + `stock.service` (entrada/ajuste/listas/movimentos, TDD).
- **Fase 2** — Baixa automática: `closeOrder` dá baixa transacional via `applyOrderStockExit` (TDD) + rota de fechamento passa `closedById`.
- **Fase 3** — API: catálogo aceita config de estoque + rotas de estoque (entrada/ajuste/listar/movimentos).
- **Fase 4** — UI: campos de estoque no `CatalogManager` + aba **Estoque** (`StockPanel`) + verificação E2E.

Cada fase é entregável e reversível de forma independente.

---

# FASE 0 — Modelos de dados

## Task 0.1: Campos de estoque + StockMovement no schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Enum** (perto dos enums de vendas, ex.: após `enum OrderPayment`):

```prisma
enum StockMovementKind {
  ENTRADA // compra/reposição (+)
  SAIDA   // venda: baixa por comanda fechada (−)
  AJUSTE  // inventário/correção/perda (+/−)
}
```

**Step 2: Estender `model CatalogItem`** (adicionar campos ao model existente, ~linha 228; NÃO remova os campos atuais):

```prisma
  // --- Controle de estoque (opt-in; só faz sentido em kind = PRODUTO) ---
  trackStock Boolean @default(false) // liga o controle p/ este item
  sku        String? // código interno opcional
  stockQty   Int     @default(0) // saldo atual (desnormalizado; = Σ dos movimentos)
  minStock   Int     @default(0) // alerta quando stockQty <= minStock
  costCents  Int? // custo unitário em centavos (opcional; p/ valor em estoque)
  stockMovements StockMovement[]
```

E acrescente um índice ao final do model (junto do `@@index([accountId, active])` existente):

```prisma
  @@index([accountId, trackStock])
```

**Step 3: Model novo** (após `model OrderItem`, ~linha 280):

```prisma
// Livro-razão imutável de estoque: cada variação de saldo é uma linha (append-only).
// delta = variação aplicada (+entrada, −saída); balanceAfter = saldo resultante
// (snapshot p/ auditoria e reconciliação com CatalogItem.stockQty). orderId liga a
// baixa à comanda que a gerou (SAIDA).
model StockMovement {
  id            String            @id @default(cuid())
  accountId     String
  account       User              @relation("StockMovementAccount", fields: [accountId], references: [id], onDelete: Cascade)
  catalogItemId String
  catalogItem   CatalogItem       @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  kind          StockMovementKind
  delta         Int // +entrada / −saída / ± ajuste
  balanceAfter  Int // saldo do item após aplicar o delta
  reason        String? // nota livre (fornecedor, "inventário", "perda")
  orderId       String? // comanda de origem (quando SAIDA)
  order         Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)
  unitCostCents Int? // custo unitário no caso de ENTRADA (snapshot)
  createdById   String
  createdBy     User              @relation("StockMovementCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime          @default(now())

  @@index([accountId, catalogItemId, createdAt])
  @@index([orderId])
}
```

**Step 4: Relações inversas.** Em `model User`, junto das de vendas (~linha 169):

```prisma
  stockMovements        StockMovement[] @relation("StockMovementAccount")
  stockMovementsCreated StockMovement[] @relation("StockMovementCreatedBy")
```

Em `model Order`, junto de `items`:

```prisma
  stockMovements StockMovement[]
```

> **Atenção:** `StockMovement` tem DUAS relações para `User` (`account`/`createdBy`) → nomes obrigatórios. As relações para `CatalogItem` e `Order` são únicas → sem nome.

**Step 5: Aplicar no dev**

Run: `npx prisma db push`
Expected: "Your database is now in sync…" + client regenerado.
Run: `npx prisma validate` → "The schema is valid."
Run: `npx tsc --noEmit` → sem erros novos.

**Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(estoque): campos de estoque em CatalogItem + StockMovement (ledger)"
```

---

## Task 0.2: SQL manual para produção (não aplicar aqui)

**Files:**
- Create: `prisma/manual/2026-07-04-estoque.sql`

Gere o DDL exato (`npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`) e adapte só os pedaços novos (colunas de `CatalogItem`, enum e tabela `StockMovement`) para idempotência. Modelo esperado:

```sql
-- Controle de estoque: colunas em CatalogItem + StockMovement (ledger).
-- Aplicar em PROD manualmente (Supabase SQL Editor). Idempotente e ADITIVO.

ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "trackStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "stockQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "minStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "costCents" INTEGER;
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_trackStock_idx" ON "CatalogItem"("accountId", "trackStock");

DO $$ BEGIN CREATE TYPE "StockMovementKind" AS ENUM ('ENTRADA','SAIDA','AJUSTE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "unitCostCents" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StockMovement_accountId_catalogItemId_createdAt_idx" ON "StockMovement"("accountId", "catalogItemId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_orderId_idx" ON "StockMovement"("orderId");

DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validar: select to_regclass('public."StockMovement"');
-- Conferir colunas: select column_name from information_schema.columns where table_name='CatalogItem' and column_name in ('trackStock','sku','stockQty','minStock','costCents');
```

> Confira que os nomes de índice/constraint batem com o `migrate diff`. Se divergir, use o do Prisma.

**Step 2: Commit**

```bash
git add prisma/manual/2026-07-04-estoque.sql
git commit -m "chore(db): SQL manual do controle de estoque (aplicação manual em prod)"
```

---

# FASE 1 — Serviços

## Task 1.1: `catalog.service` aceita config de estoque (com teste)

**Files:**
- Modify: `src/server/services/catalog.service.ts`
- Modify: `src/server/services/catalog.service.test.ts`

Estende `CatalogItemDTO`, `toDTO`, `createCatalogItem` e `updateCatalogItem` para os campos de config: `trackStock`, `sku`, `minStock`, `costCents`. **`stockQty` é exposto no DTO (leitura) mas NUNCA é setado por aqui** — quantidade só muda via `stock.service` (movimentos), pra manter o invariante `stockQty = Σ deltas`.

**Step 1: Teste que falha** (anexar ao describe existente):

```ts
it("cria produto com controle de estoque e expõe os campos", async () => {
  const a = await makeOwner();
  const item = await createCatalogItem(a, {
    name: "Pomada", priceCents: 2500, kind: "PRODUTO",
    trackStock: true, sku: "POM-01", minStock: 3, costCents: 1200,
  });
  expect(item.trackStock).toBe(true);
  expect(item.sku).toBe("POM-01");
  expect(item.stockQty).toBe(0); // nasce zerado; entra estoque via movimento
  expect(item.minStock).toBe(3);
  expect(item.costCents).toBe(1200);

  const upd = await updateCatalogItem(a, item.id, { minStock: 5, trackStock: false, sku: null });
  expect(upd.minStock).toBe(5);
  expect(upd.trackStock).toBe(false);
  expect(upd.sku).toBeNull();
});

it("serviço comum ignora campos de estoque (default off)", async () => {
  const a = await makeOwner();
  const item = await createCatalogItem(a, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
  expect(item.trackStock).toBe(false);
  expect(item.stockQty).toBe(0);
  expect(item.sku).toBeNull();
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/catalog.service.test.ts`
Expected: FAIL (propriedades inexistentes no DTO).

**Step 3: Implementar** — edite `catalog.service.ts`:

- Amplie a interface:

```ts
export interface CatalogItemDTO {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  active: boolean;
  trackStock: boolean;
  sku: string | null;
  stockQty: number;
  minStock: number;
  costCents: number | null;
}
```

- `toDTO` (aceita o registro completo do Prisma e projeta os novos campos):

```ts
function toDTO(o: {
  id: string; kind: CatalogItemKind; name: string; priceCents: number; active: boolean;
  trackStock: boolean; sku: string | null; stockQty: number; minStock: number; costCents: number | null;
}): CatalogItemDTO {
  return {
    id: o.id, kind: o.kind, name: o.name, priceCents: o.priceCents, active: o.active,
    trackStock: o.trackStock, sku: o.sku, stockQty: o.stockQty, minStock: o.minStock, costCents: o.costCents,
  };
}
```

- `createCatalogItem` — aceite os campos de config (sem `stockQty`):

```ts
const stockConfigSchema = z.object({
  trackStock: z.boolean().optional(),
  sku: z.string().trim().max(60).nullish(),
  minStock: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).nullish(),
});

export async function createCatalogItem(
  accountId: string,
  data: {
    name: string; priceCents: number; kind?: CatalogItemKind;
    trackStock?: boolean; sku?: string | null; minStock?: number; costCents?: number | null;
  },
): Promise<CatalogItemDTO> {
  const parsed = upsertSchema.parse(data);
  const cfg = stockConfigSchema.parse(data);
  const item = await prisma.catalogItem.create({
    data: {
      accountId, name: parsed.name, priceCents: parsed.priceCents, kind: parsed.kind,
      trackStock: cfg.trackStock ?? false,
      sku: cfg.sku?.trim() || null,
      minStock: cfg.minStock ?? 0,
      costCents: cfg.costCents ?? null,
    },
  });
  return toDTO(item);
}
```

- `updateCatalogItem` — aceite os mesmos campos no patch (continua sem tocar `stockQty`):

```ts
export async function updateCatalogItem(
  accountId: string,
  id: string,
  data: {
    name?: string; priceCents?: number; kind?: CatalogItemKind; active?: boolean;
    trackStock?: boolean; sku?: string | null; minStock?: number; costCents?: number | null;
  },
): Promise<CatalogItemDTO> {
  const owned = await prisma.catalogItem.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Item não encontrado.");
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Nome obrigatório.");
    patch.name = name;
  }
  if (data.priceCents !== undefined) {
    if (!Number.isInteger(data.priceCents) || data.priceCents < 0) throw new Error("Preço inválido.");
    patch.priceCents = data.priceCents;
  }
  if (data.kind !== undefined) patch.kind = data.kind;
  if (data.active !== undefined) patch.active = data.active;
  if (data.trackStock !== undefined) patch.trackStock = data.trackStock;
  if (data.sku !== undefined) patch.sku = data.sku?.trim() || null;
  if (data.minStock !== undefined) {
    if (!Number.isInteger(data.minStock) || data.minStock < 0) throw new Error("Mínimo inválido.");
    patch.minStock = data.minStock;
  }
  if (data.costCents !== undefined) patch.costCents = data.costCents === null ? null : data.costCents;
  const item = await prisma.catalogItem.update({ where: { id }, data: patch });
  return toDTO(item);
}
```

> `listCatalogItems` e `seedCatalogFromTemplate` não mudam (o `toDTO` já projeta os novos campos; itens semeados nascem com estoque off).

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/catalog.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(estoque): catalog.service aceita config de estoque (trackStock/sku/minStock/costCents)"
```

---

## Task 1.2: `stock.service` — entrada, ajuste, listas, movimentos (com teste)

**Files:**
- Create: `src/server/services/stock.service.ts`
- Test: `src/server/services/stock.service.test.ts`

Regras: escopo por `accountId`; movimentos só em item com `trackStock`. `recordEntry` (+qty) usa `increment` atômico. `recordAdjustment(newQty)` acerta o saldo pra uma contagem (inventário): `delta = newQty − atual`. Todo movimento grava `balanceAfter`. `applyOrderStockExit` (baixa de venda) fica aqui para ser chamado pelo `closeOrder` na Fase 2.

**Step 1: Teste que falha**

```ts
// src/server/services/stock.service.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { recordEntry, recordAdjustment, listStock, lowStockItems, listMovements } from "./stock.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `stk_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}
async function makeProduct(acc: string, name: string, min = 0) {
  const item = await createCatalogItem(acc, { name, priceCents: 1000, kind: "PRODUTO", trackStock: true, minStock: min });
  return item.id;
}

describe("stock.service", () => {
  it("entrada soma e registra movimento com balanceAfter", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Pomada");
    await recordEntry(acc, id, { qty: 10, createdById: acc, reason: "compra" });
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(10);
    const mv = await listMovements(acc, id);
    expect(mv[0].kind).toBe("ENTRADA");
    expect(mv[0].delta).toBe(10);
    expect(mv[0].balanceAfter).toBe(10);
  });

  it("ajuste acerta pra quantidade contada (inventário)", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Óleo");
    await recordEntry(acc, id, { qty: 5, createdById: acc });
    await recordAdjustment(acc, id, { newQty: 3, createdById: acc, reason: "inventário" });
    expect((await listStock(acc)).find((x) => x.id === id)?.stockQty).toBe(3);
    const mv = await listMovements(acc, id);
    expect(mv[0].kind).toBe("AJUSTE");
    expect(mv[0].delta).toBe(-2);
  });

  it("baixo estoque aparece quando <= mínimo", async () => {
    const acc = await makeOwner();
    const id = await makeProduct(acc, "Shampoo", 5);
    await recordEntry(acc, id, { qty: 4, createdById: acc });
    expect((await lowStockItems(acc)).map((x) => x.id)).toContain(id);
    await recordEntry(acc, id, { qty: 10, createdById: acc }); // 14 > 5
    expect((await lowStockItems(acc)).map((x) => x.id)).not.toContain(id);
  });

  it("rejeita qtd inválida, item de outra conta e item sem trackStock", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const id = await makeProduct(acc, "Cera");
    await expect(recordEntry(acc, id, { qty: 0, createdById: acc })).rejects.toThrow();
    await expect(recordEntry(other, id, { qty: 1, createdById: other })).rejects.toThrow();
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    await expect(recordEntry(acc, svc.id, { qty: 1, createdById: acc })).rejects.toThrow();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/stock.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```ts
// src/server/services/stock.service.ts
import { prisma } from "@/server/db/client";
import type { Prisma, StockMovementKind } from "@prisma/client";

export interface StockItemDTO {
  id: string; name: string; sku: string | null;
  stockQty: number; minStock: number; costCents: number | null; low: boolean;
}
export interface StockMovementDTO {
  id: string; kind: StockMovementKind; delta: number; balanceAfter: number;
  reason: string | null; orderId: string | null; createdAt: string;
}

function itemToDTO(o: { id: string; name: string; sku: string | null; stockQty: number; minStock: number; costCents: number | null }): StockItemDTO {
  return { id: o.id, name: o.name, sku: o.sku, stockQty: o.stockQty, minStock: o.minStock, costCents: o.costCents, low: o.stockQty <= o.minStock };
}

/** Produtos com controle de estoque ligado, por nome. */
export async function listStock(accountId: string): Promise<StockItemDTO[]> {
  const items = await prisma.catalogItem.findMany({
    where: { accountId, trackStock: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, sku: true, stockQty: true, minStock: true, costCents: true },
  });
  return items.map(itemToDTO);
}

/** Só os que estão no/abaixo do mínimo (alerta). */
export async function lowStockItems(accountId: string): Promise<StockItemDTO[]> {
  return (await listStock(accountId)).filter((i) => i.low);
}

export async function listMovements(accountId: string, catalogItemId: string, limit = 50): Promise<StockMovementDTO[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { accountId, catalogItemId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((m) => ({
    id: m.id, kind: m.kind, delta: m.delta, balanceAfter: m.balanceAfter,
    reason: m.reason, orderId: m.orderId, createdAt: m.createdAt.toISOString(),
  }));
}

async function assertTracked(tx: Prisma.TransactionClient, accountId: string, catalogItemId: string) {
  const ci = await tx.catalogItem.findFirst({ where: { id: catalogItemId, accountId, trackStock: true }, select: { id: true, stockQty: true } });
  if (!ci) throw new Error("Produto não encontrado ou sem controle de estoque.");
  return ci;
}

/** Entrada de estoque (+qty). increment atômico + movimento no mesmo tx. */
export async function recordEntry(
  accountId: string, catalogItemId: string,
  data: { qty: number; unitCostCents?: number | null; reason?: string; createdById: string },
): Promise<number> {
  if (!Number.isInteger(data.qty) || data.qty <= 0) throw new Error("Quantidade inválida.");
  return prisma.$transaction(async (tx) => {
    const ci = await assertTracked(tx, accountId, catalogItemId);
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: { increment: data.qty } }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "ENTRADA", delta: data.qty, balanceAfter: updated.stockQty,
      reason: data.reason?.trim() || null, unitCostCents: data.unitCostCents ?? null, createdById: data.createdById,
    } });
    return updated.stockQty;
  });
}

/** Ajuste/inventário: define o saldo para `newQty`, gravando o delta. */
export async function recordAdjustment(
  accountId: string, catalogItemId: string,
  data: { newQty: number; reason?: string; createdById: string },
): Promise<number> {
  if (!Number.isInteger(data.newQty) || data.newQty < 0) throw new Error("Quantidade inválida.");
  return prisma.$transaction(async (tx) => {
    const ci = await assertTracked(tx, accountId, catalogItemId);
    const delta = data.newQty - ci.stockQty;
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: data.newQty }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "AJUSTE", delta, balanceAfter: updated.stockQty,
      reason: data.reason?.trim() || null, createdById: data.createdById,
    } });
    return updated.stockQty;
  });
}

/**
 * Baixa de venda ao fechar a comanda. Chamado DENTRO da transação de closeOrder.
 * Para cada linha ligada a um produto rastreado da conta: decrementa (atômico) e
 * grava SAIDA. Ignora linhas avulsas e itens sem trackStock. NÃO bloqueia se faltar
 * estoque (permite negativo — nunca travar a venda).
 */
export async function applyOrderStockExit(
  tx: Prisma.TransactionClient,
  accountId: string,
  items: { catalogItemId: string | null; quantity: number }[],
  orderId: string,
  createdById: string,
): Promise<void> {
  for (const it of items) {
    if (!it.catalogItemId) continue;
    const ci = await tx.catalogItem.findFirst({ where: { id: it.catalogItemId, accountId, trackStock: true }, select: { id: true } });
    if (!ci) continue;
    const updated = await tx.catalogItem.update({ where: { id: ci.id }, data: { stockQty: { decrement: it.quantity } }, select: { stockQty: true } });
    await tx.stockMovement.create({ data: {
      accountId, catalogItemId: ci.id, kind: "SAIDA", delta: -it.quantity, balanceAfter: updated.stockQty, orderId, createdById,
    } });
  }
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/stock.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/stock.service.ts src/server/services/stock.service.test.ts
git commit -m "feat(estoque): stock.service (entrada/ajuste/listas/movimentos + baixa de venda)"
```

---

# FASE 2 — Baixa automática no fechamento

## Task 2.1: `closeOrder` dá baixa transacional (com teste)

**Files:**
- Modify: `src/server/services/order.service.ts` (`closeOrder`)
- Modify: `src/server/services/order.service.test.ts` (novo describe)

Torna o fechamento **atômico** (`$transaction`): fecha a comanda e dá baixa nos produtos rastreados na mesma transação. Adiciona `closedById` **opcional** a `closeOrder` (fallback = `openedById`) — assim os testes/chamadas existentes de `closeOrder(acc, id, { payment })` continuam compilando e verdes.

**Step 1: Teste que falha** (novo describe em `order.service.test.ts`). ⚠️ `createCatalogItem`, `openOrder`, `addItem`, `closeOrder` e `makeOwner` **já estão importados/definidos** no arquivo (linhas 3–4/6) — adicione SÓ o import de estoque (NÃO re-importe `createCatalogItem`, seria import duplicado):

```ts
import { recordEntry, listStock, listMovements } from "./stock.service";

describe("closeOrder — baixa de estoque", () => {
  it("baixa o estoque do produto rastreado ao fechar", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Pomada", priceCents: 2500, kind: "PRODUTO", trackStock: true });
    await recordEntry(acc, prod.id, { qty: 10, createdById: acc });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 3 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    expect((await listStock(acc)).find((x) => x.id === prod.id)?.stockQty).toBe(7);
    const mv = await listMovements(acc, prod.id);
    expect(mv[0].kind).toBe("SAIDA");
    expect(mv[0].delta).toBe(-3);
    expect(mv[0].orderId).toBe(o.id);
  });

  it("não mexe em estoque de serviço nem de linha avulsa", async () => {
    const acc = await makeOwner();
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    const o = await openOrder(acc, { openedById: acc, customerName: "Y" });
    await addItem(acc, o.id, { catalogItemId: svc.id, quantity: 1 });
    await addItem(acc, o.id, { name: "Gorjeta", unitPriceCents: 500, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "PIX", closedById: acc });
    expect(await listMovements(acc, svc.id)).toHaveLength(0);
  });

  it("permite estoque negativo (não bloqueia a venda)", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Cera", priceCents: 1000, kind: "PRODUTO", trackStock: true });
    await recordEntry(acc, prod.id, { qty: 1, createdById: acc });
    const o = await openOrder(acc, { openedById: acc, customerName: "Z" });
    await addItem(acc, o.id, { catalogItemId: prod.id, quantity: 5 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    expect((await listStock(acc)).find((x) => x.id === prod.id)?.stockQty).toBe(-4);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/order.service.test.ts`
Expected: FAIL — `closeOrder` ainda não dá baixa (e não aceita `closedById`).

**Step 3: Implementar** — em `order.service.ts`:

- Import no topo: `import { applyOrderStockExit } from "./stock.service";`
- Reescreva `closeOrder`:

```ts
export async function closeOrder(
  accountId: string,
  orderId: string,
  data: { payment: OrderPayment; note?: string; closedById?: string },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId); // já inclui items
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const closerId = data.closedById ?? order.openedById;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "FECHADA", payment: data.payment, note: data.note?.trim() || null, closedAt: new Date() },
    });
    await applyOrderStockExit(tx, accountId, order.items, orderId, closerId);
  });
  return toDTO(await loadOwned(accountId, orderId));
}
```

> `applyOrderStockExit` recebe `order.items` (cada um tem `catalogItemId` e `quantity`) — bate com a assinatura. Sem produto rastreado, é no-op (por isso os testes antigos de comanda seguem verdes). Sem `stock.service` haver import circular: ele não importa `order.service`.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/order.service.test.ts`
Expected: PASS (novos + os antigos, que fecham sem `closedById` e sem produto rastreado).

**Step 5: Commit**

```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(estoque): baixa automática de estoque no fechamento da comanda (transacional)"
```

---

## Task 2.2: Rota de fechamento passa `closedById`

**Files:**
- Modify: `src/app/api/vendas/orders/[id]/route.ts` (PATCH)

**Step 1:** na chamada de `closeOrder`, passe o operador que fechou:

```ts
// PATCH: substituir a linha do closeOrder por:
const order = await closeOrder(ctx.tenantUserId, id, { ...parsed.data, closedById: ctx.sessionUserId });
```

(O `closeSchema` não muda — `closedById` vem do contexto, não do corpo.)

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add "src/app/api/vendas/orders/[id]/route.ts"
git commit -m "feat(estoque): fechamento atribui a baixa ao operador (closedById)"
```

---

# FASE 3 — API

## Task 3.1: Catálogo aceita config de estoque

**Files:**
- Modify: `src/app/api/vendas/catalog/route.ts` (POST — createSchema)
- Modify: `src/app/api/vendas/catalog/[id]/route.ts` (PATCH — patchSchema)

**Step 1:** amplie os schemas zod das duas rotas com os campos de config (o serviço já os aceita, Task 1.1):

```ts
// campos a acrescentar em AMBOS os schemas:
  trackStock: z.boolean().optional(),
  sku: z.string().nullish(),
  minStock: z.number().int().optional(),
  costCents: z.number().int().nullish(),
```

No POST (`catalog/route.ts`), o `createSchema` passa a incluir esses campos; a chamada `createCatalogItem(ctx.tenantUserId, parsed.data)` já os repassa. No PATCH (`catalog/[id]/route.ts`), idem para `updateCatalogItem`.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/vendas/catalog/route.ts "src/app/api/vendas/catalog/[id]/route.ts"
git commit -m "feat(estoque): API de catálogo aceita config de estoque"
```

---

## Task 3.2: Rotas de estoque (listar / entrada / ajuste / movimentos)

**Files:**
- Create: `src/app/api/vendas/stock/route.ts` (GET lista)
- Create: `src/app/api/vendas/stock/[id]/entry/route.ts` (POST entrada)
- Create: `src/app/api/vendas/stock/[id]/adjust/route.ts` (POST ajuste)
- Create: `src/app/api/vendas/stock/[id]/movements/route.ts` (GET histórico)

Todas: `dynamic = "force-dynamic"`, `getTenantContext()`, 401 sem sessão, **403 sem `canSettings`**, zod, `try/catch → { error }`. `createdById = ctx.sessionUserId`; escopo `accountId = ctx.tenantUserId`. Confirme a forma de `params` (Promise) numa rota `[id]` existente.

**Step 1:** `stock/route.ts` (lista + itens em baixo estoque):

```ts
// src/app/api/vendas/stock/route.ts
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listStock } from "@/server/services/stock.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const items = await listStock(ctx.tenantUserId);
  return NextResponse.json({ items }); // cada item traz `low`; o UI conta os baixos
}
```

**Step 2:** `stock/[id]/entry/route.ts`:

```ts
// src/app/api/vendas/stock/[id]/entry/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { recordEntry } from "@/server/services/stock.service";

export const dynamic = "force-dynamic";

const schema = z.object({ qty: z.number().int().positive(), unitCostCents: z.number().int().nullish(), reason: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const stockQty = await recordEntry(ctx.tenantUserId, id, { ...parsed.data, createdById: ctx.sessionUserId });
    return NextResponse.json({ stockQty });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

**Step 3:** `stock/[id]/adjust/route.ts` (igual, corpo `{ newQty: z.number().int().min(0), reason?: string }`, chamando `recordAdjustment`).

**Step 4:** `stock/[id]/movements/route.ts` (GET → `listMovements(ctx.tenantUserId, id)`; 401/403 canSettings).

**Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 6: Commit**

```bash
git add src/app/api/vendas/stock
git commit -m "feat(estoque): API de estoque (listar/entrada/ajuste/movimentos)"
```

---

# FASE 4 — UI e verificação

## Task 4.1: Config de estoque no CatalogManager

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx`

Quando `kind === "PRODUTO"`, o form (adicionar e editar) mostra um checkbox **"Controlar estoque"**; ligado, revela **SKU**, **Estoque inicial** (só no adicionar), **Mínimo** e **Custo (R$)**. No modo leitura, produto rastreado mostra um selo **"Estoque: N"** (vermelho se `stockQty <= minStock`).

**Step 1: Ajustes** (esboço — siga o componente atual):

- Amplie `interface Item` com: `trackStock: boolean; sku: string | null; stockQty: number; minStock: number; costCents: number | null;`
- Estados novos do form de adicionar: `trackStock`, `sku`, `initialQty`, `minStock`, `costStr`. Aparecem só quando `kind === "PRODUTO"`.
- No `addItem()`: mande os campos de config no POST `/api/vendas/catalog` (`trackStock`, `sku`, `minStock`, `costCents` via `parseBRLToCents(costStr)`). **Se `trackStock` e `initialQty > 0`**, após criar, faça um POST `/api/vendas/stock/${novoId}/entry` com `{ qty: initialQty, reason: "Estoque inicial" }` e então `load()`. (O POST de catálogo devolve `{ item }` com o `id`.)
- No form de edição: idem para SKU/mínimo/custo/trackStock (sem "estoque inicial" — quantidade só muda na aba Estoque).
- No modo leitura, se `it.trackStock`, renderize o selo de estoque com cor condicional.

**Step 2: Verificar** — montado no workspace (Task 4.2). `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/vendas/CatalogManager.tsx
git commit -m "feat(estoque): config de estoque no cadastro de produtos"
```

---

## Task 4.2: Aba "Estoque" (StockPanel) + workspace

**Files:**
- Create: `src/components/vendas/StockPanel.tsx`
- Modify: `src/components/vendas/VendasWorkspace.tsx` (aba nova, gated por `canEdit`)

**Step 1: `StockPanel.tsx`** (client; padrão visual de `CatalogManager`/`ReportsPanel`):

- Carrega `GET /api/vendas/stock` → `{ items }` (cada um com `stockQty`, `minStock`, `low`, `sku`, `costCents`).
- **Topo:** se houver itens `low`, um aviso "N produto(s) no/abaixo do mínimo".
- **Lista:** por produto — nome, SKU, **saldo atual** (vermelho se `low`), mínimo. Ações:
  - **Entrada** (+): campo qty (+ custo/nota opcionais) → `POST /api/vendas/stock/:id/entry` → `load()`.
  - **Ajustar**: campo "saldo real" → `POST /api/vendas/stock/:id/adjust` → `load()`.
  - **Movimentos**: expande e busca `GET /api/vendas/stock/:id/movements` (kind, delta, saldo, data).
- Vazio: "Nenhum produto com controle de estoque. Ligue 'Controlar estoque' num produto no Catálogo."

**Step 2: Aba no workspace** — em `VendasWorkspace.tsx` (⚠️ ver nota de coordenação: se a aba "Despesas" já foi adicionada pelo outro plano, **acrescente** "Estoque" à lista, não substitua):

```tsx
import { StockPanel } from "./StockPanel";
type Tab = "comandas" | "catalogo" | "estoque" | "relatorios"; // + "despesas" se já existir
// TABS: inclua { value: "estoque", label: "Estoque" } SÓ quando canEdit (é de dono):
const tabs = [
  { value: "comandas", label: "Comandas" },
  { value: "catalogo", label: "Catálogo" },
  ...(canEdit ? [{ value: "estoque", label: "Estoque" } as const] : []),
  { value: "relatorios", label: "Relatórios" },
];
// ...no corpo: {tab === "estoque" && <StockPanel />}
```

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/components/vendas/StockPanel.tsx src/components/vendas/VendasWorkspace.tsx
git commit -m "feat(estoque): aba Estoque (saldo, entrada, ajuste, movimentos)"
```

---

## Task 4.3: Verificação end-to-end (manual)

Use a skill @verify. Run: `npm run dev`.

**Checklist:**
- [ ] **Cadastro:** no Catálogo, criar produto "Pomada R$25" com **Controlar estoque** ligado, SKU "POM-01", **estoque inicial 10**, mínimo 3 → aparece "Estoque: 10".
- [ ] **Serviço não tem estoque:** criar "Corte R$40" (serviço) → nenhum campo de estoque aparece.
- [ ] **Baixa na venda:** nova comanda → adicionar 3× Pomada → fechar em DINHEIRO → na aba **Estoque**, saldo da Pomada = **7**; em Movimentos há uma **SAIDA −3** ligada à comanda.
- [ ] **Entrada:** dar entrada de +10 na Pomada → saldo 17; movimento **ENTRADA +10**.
- [ ] **Ajuste/inventário:** ajustar saldo real para 15 → movimento **AJUSTE −2**, saldo 15.
- [ ] **Alerta de baixo estoque:** vender/ajustar até saldo ≤ mínimo → produto destacado e contador de alerta aparece.
- [ ] **Estoque negativo não trava:** produto com saldo 1, vender 5 → comanda fecha normal, saldo = **−4**, produto sinalizado.
- [ ] **Avulso/serviço:** comanda com serviço + linha avulsa → nenhum movimento de estoque criado.
- [ ] **Permissão:** operador sem `canSettings` não vê a aba Estoque; `GET /api/vendas/stock` e `POST .../entry` retornam 403. (Mas fechar comanda com produto rastreado **dá baixa normal** — é server-side.)
- [ ] `npx vitest run` (verde) e `npx tsc --noEmit` (limpo).

---

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde (incluindo os testes de comanda antigos, que fecham sem `closedById`).
- [ ] `npx tsc --noEmit` — limpo.
- [ ] `stockQty` só muda por movimento (`ENTRADA`/`SAIDA`/`AJUSTE`); nunca setado no catálogo. `balanceAfter` bate com o saldo.
- [ ] Baixa acontece **só no fechamento**, dentro de transação (fecha + baixa são atômicos).
- [ ] Estoque não bloqueia venda (permite negativo).
- [ ] Todo dado escopado por `accountId`; movimentos e config gated por `canSettings`.

**Notas de produção (para o dono aplicar):**
- Aplicar `prisma/manual/2026-07-04-estoque.sql` no Supabase SQL Editor de **prod** ANTES de usar. Validar `select to_regclass('public."StockMovement"')` e as colunas novas de `CatalogItem`.
- As colunas de `CatalogItem` são aditivas com default → itens existentes nascem com `trackStock=false`/`stockQty=0` (nenhum produto atual passa a "controlar estoque" sozinho). Sem risco de leitura degradada.
- Deploy pela CLI da Vercel (memória `vercel-hobby-push-block`).
- Coordenar com o deploy do módulo de Despesas se ambos forem juntos (mesmo arquivo `schema.prisma` e `VendasWorkspace.tsx` — ver nota de coordenação no topo).

**Fora de escopo (v2, sob demanda):** grade/variantes de produto; venda por peso (`quantity` fracionado); valorização por custo médio; unicidade de SKU + leitor de código de barras; reserva em comanda aberta; estorno de baixa ao reabrir comanda; relatório de "curva ABC"/giro; mostrar saldo do produto direto no `OrderBoard` ao adicionar à comanda (bom próximo retoque).
```
