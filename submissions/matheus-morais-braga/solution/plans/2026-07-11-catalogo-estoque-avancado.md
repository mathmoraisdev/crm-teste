# Catálogo/estoque++ — valorização, margem, código de barras e grade

> **For Claude:** REQUIRED SUB-SKILL: use `executing-plans` para implementar este plano tarefa a tarefa.
> **Mestre:** iniciativa 12 de `2026-07-05-roadmap-multinegocio.md` (Release 4, **Onda G**). Este plano é filho do mestre.

**Goal:** dar ao varejo o que falta para operar margem: **valorizar o estoque** (Σ qtd×custo), **medir a
margem** (potencial no catálogo e **realizada** nas vendas), **vender por código de barras/EAN** (bipar no
caixa) e organizar **variações/grade** (tamanho/cor). Quase tudo o motor já tem: `CatalogItem.costCents`
(custo unitário) e `StockMovement.unitCostCents` **existem e nunca são exibidos**; o que falta é surface +
uma pitada de schema (barcode, agrupamento de grade e um snapshot de custo na linha da comanda).

**Architecture:** três frentes sobre a base de catálogo **flat** já existente (`CatalogItem` + `StockMovement`
+ `OrderItem`), sem introduzir um modelo relacional novo de variação:
1. **Valorização + margem** — serviços de leitura puros/agregadores (`margin.ts` puro, `stock-valuation.service`,
   `salesMargin` no `sales-report.service`) sobre `costCents` já existente; a margem **realizada** ganha um
   **snapshot de custo por linha** (`OrderItem.unitCostCents`, no mesmo ponto de fechamento onde
   `commissionCents`/`professionalId` já são snapshotados).
2. **Código de barras** — `CatalogItem.barcode` (único por conta) + `findByBarcode` + endpoint de lookup +
   campo de "bipar" no `OrderBoard`.
3. **Grade (SKU flat)** — `CatalogItem.variantGroup` (rótulo de agrupamento) — variação = **outra linha de
   catálogo** agrupada, reusando 100% do estoque/venda/barcode. O modelo `ItemVariant` fica **adiado**
   (ver Decisões).

**Tech Stack:** Next.js 15 (App Router, route handlers) · Prisma 6 + Postgres (Supabase) · Zod · React 19
· Tailwind (tokens de tema) · Vitest.

---

## Decisões travadas (do mestre / conscientes)

- **Onda G = UM arquivo composto** `prisma/manual/2026-07-11-onda-g.sql`, idempotente (`IF NOT EXISTS`),
  aplicado no Supabase SQL Editor pelo dono. As três fases **compõem** o mesmo arquivo (padrão da Onda A/E/F —
  [[prod-schema-drift-destravar]]). Dev usa `prisma db push`; PROD só o `manual/*.sql`.
- **Margem realizada via SNAPSHOT, não live-join** — *desvio consciente:* o mestre listava a Onda G só com
  `CatalogItem.barcode` + `ItemVariant` opcional, mas o relatório de margem realizada ganha
  **`OrderItem.unitCostCents`** (custo do item no momento do fechamento). Sem ele, a margem teria de re-derivar
  o custo do `CatalogItem` **ao vivo** — frágil por dois motivos: (a) o custo muda com o tempo (uma venda de
  março não tem a margem de hoje); (b) `OrderItem.catalogItemId` é `SetNull` (item pode ser excluído) → custo
  some justamente onde importa. É **exatamente** o padrão já adotado para `nameSnapshot`/`unitPriceCents`/
  `commissionCents`/`professionalId`. Um `Int?` barato, gravado no mesmo laço de fechamento.
- **Variações = SKU flat (`variantGroup` rótulo), `ItemVariant` ADIADO** — *decisão do plano filho pedida pelo
  mestre.* Uma variação ("Camiseta P", "Camiseta M") é **outra `CatalogItem`** com um rótulo de grupo comum.
  Reusa TODO o maquinário (estoque por linha, barcode por linha, preço por linha, `OrderItem` por linha) com
  **zero** plumbing novo. Um `ItemVariant` relacional exigiria reescrever `StockMovement`, `OrderItem` e o
  barcode para apontarem para a variação — grande superfície, não justificada no v1. Fica registrado como
  **onda futura** se a demanda por matriz cor×tamanho aparecer.
- **Barcode único por conta, NULLs coexistem** — `@@unique([accountId, barcode])`. No Postgres NULLs são
  distintos (mesmo padrão de `Order.number`), então itens sem código convivem; bipar resolve para **exatamente
  um** item da conta.
- **Custo ausente = 0 no somatório, mas CONTADO e exibido** — valorização/margem **nunca** mentem: item sem
  `costCents` entra como custo 0 mas o serviço devolve `withoutCostCount` e a UI sinaliza "N itens sem custo →
  margem/valor parcial". Silenciar seria pior que expor o parcial.
- **Dinheiro em centavos** (`Int`); `parseBRLToCents`/`formatCentsBRL` só na borda ([[caixa-despesas-reposicionamento]]).
  Margem em **pontos-base** (`bps`, `Int`) internamente — nada de float persistido.
- **Opt-in preservado** — valorização/margem só olham quem tem `costCents`; barcode e `variantGroup` são
  opcionais (null = comportamento atual). Nada polui os ~50 modelos de serviço puro.
- **Tema:** só tokens/CSS vars, nunca hex fixo ([[design-tokens-dark-theme]]). **Tenancy:** dono =
  `ctx.tenantUserId`; leitura de relatório/estoque é escopada por conta; edição de catálogo exige
  `canSettings`.

---

## Contexto de código (leia antes de começar)

- **Schema:** [prisma/schema.prisma](../../prisma/schema.prisma) — `CatalogItem` (L348-376: já tem
  `costCents Int?` L368, `sku` L365, `stockQty` L366, `trackStock` L364), `OrderItem` (L430-449: já tem
  `nameSnapshot`/`unitPriceCents`/`commissionCents`/`professionalId` como snapshots de fechamento),
  `StockMovement` (L469-488: `unitCostCents Int?` L481, snapshot de ENTRADA).
- **Catálogo (serviço):** [catalog.service.ts](../../src/server/services/catalog.service.ts) —
  `CatalogItemDTO` (L6-19), `upsertSchema`/`stockConfigSchema` (L21-37), `createCatalogItem` (L51),
  `updateCatalogItem` (L84), `toDTO` (L39). **Aqui** entram `barcode`/`variantGroup` no DTO+schema+patch.
- **Estoque (serviço):** [stock.service.ts](../../src/server/services/stock.service.ts) — `StockItemDTO`
  (L4-7, já traz `costCents`), `listStock` (L18), `applyOrderStockExit` (L91, baixa no fechamento). A
  valorização é um serviço **novo** irmão deste.
- **Fechamento (snapshot):** [order.service.ts:316-347](../../src/server/services/order.service.ts#L316-L347)
  — `applyOrderStockExit` + laço de snapshot de comissão dentro de `closeOrder`. **Aqui** entra o snapshot de
  `OrderItem.unitCostCents` (laço próprio, roda sempre — independe de comissão).
- **Relatórios (serviço):** [sales-report.service.ts](../../src/server/services/sales-report.service.ts) —
  `topItems` (L118-129, mostra o padrão de `closedOrderIds` + agregação por `nameSnapshot`), `closedOrderIds`
  (helper interno). `salesMargin` nasce aqui, no mesmo estilo.
- **Relatórios (rota+UI):** [api/vendas/reports/route.ts](../../src/app/api/vendas/reports/route.ts)
  (compõe os relatórios; despesas/comissão só p/ `canSettings`) e `ReportsPanel.tsx`.
- **Catálogo (UI):** [CatalogManager.tsx](../../src/components/vendas/CatalogManager.tsx) — form de add
  (L477-566) e edição inline (L320-405), já com bloco de estoque para `PRODUTO` (SKU/mín/custo). Barcode e
  grupo de grade entram aqui.
- **Caixa (UI):** [OrderBoard.tsx](../../src/components/vendas/OrderBoard.tsx) — `CatalogItem` (L44, precisa
  só `id/kind/name/priceCents/active`), filtro do picker (L451-453), `addFromCatalog` (L481-489, já
  incrementa a linha existente). O "bipar" resolve barcode→`addFromCatalog(id)`.
- **Estoque (UI):** [StockPanel.tsx](../../src/components/vendas/StockPanel.tsx) — lista com saldo/custo
  (L188-193); ganha a faixa de **valor total do estoque**.
- **Workspace/abas:** [VendasWorkspace.tsx](../../src/components/vendas/VendasWorkspace.tsx) (abas
  Comandas/Catálogo/Estoque/Despesas/Relatórios).
- **Money:** [src/lib/money.ts](../../src/lib/money.ts) (`formatCentsBRL`, `parseBRLToCents`).

### Convenções firmes (não desvie)
- **Multi-tenant:** todo serviço recebe `accountId` (= `tenantUserId`) e filtra por ele.
- **Money em centavos** (`Int`); margem em `bps` (`Int`) internamente — `bps = round((price-cost)/price*10000)`.
- **Snapshot no fechamento** (nunca live-join p/ dado histórico): `unitCostCents` segue `commissionCents`.
- **Idempotência do SQL:** tudo `IF NOT EXISTS`; um único `onda-g.sql` composto pelas três fases.
- **Pare o `next dev` antes** de `prisma db push`/`prisma generate` (EPERM no query-engine — [[prisma-generate-dev-server-lock]]).

### Padrão de teste (Vitest) — use o estilo certo por arquivo
- **Lógica pura** (import direto, sem prisma): `margin.test.ts` (novo) — `marginBps`, `itemValueCents`.
- **Prisma mockado** (`vi.mock("@/server/db/client")` + `await import()` dentro do `it`): `offer.service.test.ts`
  é o modelo. Use para `stock-valuation.service.test.ts` e `catalog.service` (barcode/variantGroup: asserta args).
- **Banco real** (`makeOwner()`): `order.service.test.ts`, `catalog.service.test.ts`, `sales-report.service.test.ts`
  **já existem**. Use para o snapshot de custo no `closeOrder` (FK/relacional) e para `salesMargin`.
- Rodar tudo: `npm test`. Um arquivo: `npx vitest run caminho.test.ts`. Filtrar: `-t "nome"`.
- Commits em pt-BR (`feat(catalogo): ...`), um por tarefa.

---

# FASE 12.1 — Valorização de estoque + margem (custo já existe)

**Resultado:** o custo que já mora em `CatalogItem.costCents` (e o snapshot novo de venda) vira número na
tela: **valor do estoque** (Σ qtd×custo), **margem potencial** por produto (preço−custo, %) e **margem
realizada** por período (venda−custo). Introduz o **único** desvio de schema da margem: `OrderItem.unitCostCents`.

---

### Tarefa 12.1.1: `margin.ts` — matemática pura de margem/valor

**Files:**
- Create: `src/lib/margin.ts`
- Test: `src/lib/margin.test.ts`

**Step 1 — Teste que falha.**
```ts
import { describe, it, expect } from "vitest";
import { marginBps, marginCents, itemValueCents } from "./margin";

describe("margin", () => {
  it("marginCents = (preço − custo) × qtd, custo null → conta como 0", () => {
    expect(marginCents({ priceCents: 1000, costCents: 400, quantity: 2 })).toBe(1200);
    expect(marginCents({ priceCents: 1000, costCents: null, quantity: 1 })).toBe(1000);
  });
  it("marginBps = margem sobre a receita, em pontos-base (inteiro, arredondado)", () => {
    expect(marginBps({ revenueCents: 1000, costCents: 400 })).toBe(6000); // 60%
    expect(marginBps({ revenueCents: 0, costCents: 0 })).toBe(0);          // guarda div/0
    expect(marginBps({ revenueCents: 300, costCents: 100 })).toBe(6667);   // 66,67%
  });
  it("itemValueCents = saldo × custo (null → 0)", () => {
    expect(itemValueCents({ stockQty: 5, costCents: 250 })).toBe(1250);
    expect(itemValueCents({ stockQty: 5, costCents: null })).toBe(0);
    expect(itemValueCents({ stockQty: -2, costCents: 250 })).toBe(-500); // saldo negativo é permitido
  });
});
```

**Step 2 — Rode e veja falhar.** `npx vitest run src/lib/margin.test.ts` → FAIL (módulo não existe).

**Step 3 — Implemente (puro).**
```ts
/** Margem em centavos de uma linha: (preço − custo) × qtd. Custo ausente conta como 0. */
export function marginCents(i: { priceCents: number; costCents: number | null; quantity: number }): number {
  return (i.priceCents - (i.costCents ?? 0)) * i.quantity;
}
/** Margem sobre a receita em pontos-base (inteiro). Receita 0 → 0 (guarda divisão). */
export function marginBps(i: { revenueCents: number; costCents: number }): number {
  if (i.revenueCents <= 0) return 0;
  return Math.round(((i.revenueCents - i.costCents) / i.revenueCents) * 10000);
}
/** Valor imobilizado em estoque de um item: saldo × custo. Custo ausente → 0. */
export function itemValueCents(i: { stockQty: number; costCents: number | null }): number {
  return i.stockQty * (i.costCents ?? 0);
}
```

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/margin.test.ts` → PASS.

**Step 5 — Commit.**
```bash
git add src/lib/margin.ts src/lib/margin.test.ts
git commit -m "feat(catalogo): matemática pura de margem e valor de estoque"
```

---

### Tarefa 12.1.2: `stock-valuation.service` + faixa de valor no `StockPanel`

**Files:**
- Create: `src/server/services/stock-valuation.service.ts`
- Test: `src/server/services/stock-valuation.service.test.ts` (prisma mockado, estilo `offer.service.test.ts`)
- Modify: `src/app/api/vendas/stock/route.ts` (devolver a valorização junto da lista)
- Modify: `src/components/vendas/StockPanel.tsx` (faixa "Valor em estoque")

**Step 1 — Teste que falha (prisma mock).**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/server/db/client", () => ({ prisma: { catalogItem: { findMany: vi.fn() } } }));

describe("stockValuation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("soma saldo×custo dos itens rastreados e conta os sem custo", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.catalogItem.findMany as any).mockResolvedValue([
      { id: "a", name: "A", stockQty: 5, costCents: 200, priceCents: 500 }, // valor 1000
      { id: "b", name: "B", stockQty: 3, costCents: null, priceCents: 900 }, // sem custo → 0, contado
    ]);
    const { stockValuation } = await import("./stock-valuation.service");
    const r = await stockValuation("u1");
    expect(r.totalValueCents).toBe(1000);
    expect(r.withoutCostCount).toBe(1);
    expect(r.items.find((i) => i.id === "a")!.valueCents).toBe(1000);
    // margem potencial por item (preço−custo)/preço em bps
    expect(r.items.find((i) => i.id === "a")!.marginBps).toBe(6000);
  });
});
```

**Step 2 — Rode e veja falhar.** `-t stockValuation` → FAIL.

**Step 3 — Implemente.** Só leitura, reusa `margin.ts`:
```ts
import { prisma } from "@/server/db/client";
import { itemValueCents, marginBps } from "@/lib/margin";

export interface StockValuationItem {
  id: string; name: string; stockQty: number; costCents: number | null;
  priceCents: number; valueCents: number; marginBps: number;
}
export interface StockValuation {
  totalValueCents: number; withoutCostCount: number; items: StockValuationItem[];
}

/** Valor imobilizado no estoque rastreado da conta + margem potencial por item. */
export async function stockValuation(accountId: string): Promise<StockValuation> {
  const rows = await prisma.catalogItem.findMany({
    where: { accountId, trackStock: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, stockQty: true, costCents: true, priceCents: true },
  });
  let totalValueCents = 0;
  let withoutCostCount = 0;
  const items = rows.map((r) => {
    const valueCents = itemValueCents(r);
    totalValueCents += valueCents;
    if (r.costCents == null) withoutCostCount++;
    return {
      id: r.id, name: r.name, stockQty: r.stockQty, costCents: r.costCents, priceCents: r.priceCents,
      valueCents, marginBps: marginBps({ revenueCents: r.priceCents, costCents: r.costCents ?? 0 }),
    };
  });
  return { totalValueCents, withoutCostCount, items };
}
```

**Step 4 — Rota + UI.** Em `stock/route.ts`, ao montar a resposta, inclua `valuation: await stockValuation(...)`
ao lado de `items` (o `StockPanel` já consome `data.items`; adicione `data.valuation`). No `StockPanel`,
renderize uma faixa no topo (tokens de tema): **"Valor em estoque: {formatCentsBRL(totalValueCents)}"** e, se
`withoutCostCount > 0`, um aviso discreto "N itens sem custo — valor parcial". Opcional: coluna de margem % por
linha reusando `marginBps`.

**Step 5 — Verifique.** `npm test` (unit) + `npm run dev`: aba Estoque mostra o valor total; item sem custo
aparece no aviso. Skill `verify`.

**Step 6 — Commit.**
```bash
git add src/server/services/stock-valuation.service.ts src/server/services/stock-valuation.service.test.ts src/app/api/vendas/stock/route.ts src/components/vendas/StockPanel.tsx
git commit -m "feat(catalogo): valorização de estoque (valor total + margem potencial)"
```

---

### Tarefa 12.1.3: Onda G começa — `OrderItem.unitCostCents` + snapshot no fechamento

**Files:**
- Create: `prisma/manual/2026-07-11-onda-g.sql` (**dono do arquivo composto**)
- Modify: `prisma/schema.prisma` (`OrderItem.unitCostCents Int?`)
- Modify: `src/server/services/order.service.ts` (snapshot no `closeOrder`; opcional: limpar no reopen)
- Test: `src/server/services/order.service.test.ts` (**banco real; ESTENDA**)

**Step 1 — SQL idempotente.** Crie `prisma/manual/2026-07-11-onda-g.sql`:
```sql
-- Onda G (idempotente) — iniciativa 12 (Catálogo/estoque++). Três fases COMPÕEM este
-- arquivo (12.1 custo-snapshot · 12.2 barcode · 12.3 variantGroup). NÃO sobrescreva;
-- acrescente. Tudo IF NOT EXISTS → ordem de aplicação não importa. [[prod-schema-drift-destravar]]

-- ── 12.1: snapshot de custo por linha (margem realizada) ──────────────────────
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER;
```

**Step 2 — Schema + db push (dev).** Em `schema.prisma`, no `OrderItem` (perto de `commissionCents` L444):
```prisma
unitCostCents Int? // custo unitário do item no fechamento (snapshot p/ margem realizada). null = avulso/sem custo
```
Pare o `next dev` e rode `npx prisma db push` (aplica no Postgres local; **não** gere migration — [[prisma-generate-dev-server-lock]]).

**Step 3 — Teste que falha (banco real).** Em `order.service.test.ts`:
```ts
it("closeOrder snapshota unitCostCents = custo do catálogo no fechamento", async () => {
  const acc = await makeOwner();
  const prod = await createCatalogItem(acc, { name: "Bola", priceCents: 5000, kind: "PRODUTO", costCents: 2000 });
  const order = await createOrder(acc, { openedById: acc });
  await addOrderItem(acc, order.id, { catalogItemId: prod.id, quantity: 2 });
  await closeOrder(acc, order.id, { payment: "DINHEIRO", closerId: acc } as any); // ajuste à assinatura real
  const line = await prisma.orderItem.findFirst({ where: { orderId: order.id }, select: { unitCostCents: true } });
  expect(line!.unitCostCents).toBe(2000);
});
```
> Ajuste os helpers (`createOrder`/`addOrderItem`/assinatura de `closeOrder`) ao que o arquivo de teste já usa.

**Step 4 — Rode e veja falhar.** `-t "snapshota unitCostCents"` → FAIL (fica null).

**Step 5 — Implemente.** Em `closeOrder`, **dentro da transação** e **fora** do `if (creditedProId)` (roda
sempre), após `applyOrderStockExit` (L316), grave o custo de cada linha ligada a um item:
```ts
// ── Snapshot de custo por linha (margem realizada) ─────────────────────────
// Independe da comissão: toda linha com item de catálogo carimba o custo atual
// (histórico imutável — o custo do catálogo pode mudar depois). Avulso → fica null.
const catIds = [...new Set(order.items.map((i) => i.catalogItemId).filter(Boolean))] as string[];
if (catIds.length) {
  const costs = await tx.catalogItem.findMany({
    where: { id: { in: catIds }, accountId }, select: { id: true, costCents: true },
  });
  const costById = new Map(costs.map((c) => [c.id, c.costCents]));
  for (const it of order.items) {
    if (!it.catalogItemId) continue;
    const unitCostCents = costById.get(it.catalogItemId) ?? null;
    if (unitCostCents != null) await tx.orderItem.update({ where: { id: it.id }, data: { unitCostCents } });
  }
}
```
> **Reopen (opcional, consistência):** em `reopenOrder` (L409, onde limpa `professionalId`/`commissionCents`),
> pode incluir `unitCostCents: null` no `updateMany` — o próximo fechamento re-snapshota o custo vigente. Não é
> obrigatório (o close sempre sobrescreve para linhas com item), mas mantém o padrão do snapshot de comissão.

**Step 6 — Rode e veja passar.** `npx vitest run src/server/services/order.service.test.ts` → PASS.

**Step 7 — Commit.**
```bash
git add prisma/manual/2026-07-11-onda-g.sql prisma/schema.prisma src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(catalogo): snapshot de custo por linha no fechamento (Onda G)"
```

---

### Tarefa 12.1.4: `salesMargin` + relatório de margem realizada (serviço → rota → UI)

**Files:**
- Modify: `src/server/services/sales-report.service.ts` (`salesMargin`)
- Test: `src/server/services/sales-report.service.test.ts` (**banco real; ESTENDA**)
- Modify: `src/app/api/vendas/reports/route.ts` (só `canSettings` — margem é de dono)
- Modify: `src/components/vendas/ReportsPanel.tsx` (bloco "Margem")

**Step 1 — Teste que falha (banco real).**
```ts
describe("salesMargin", () => {
  it("agrega receita, custo e margem das comandas fechadas no período", async () => {
    const acc = await makeOwner();
    const prod = await createCatalogItem(acc, { name: "Bola", priceCents: 5000, kind: "PRODUTO", costCents: 2000 });
    const o = await createOrder(acc, { openedById: acc });
    await addOrderItem(acc, o.id, { catalogItemId: prod.id, quantity: 2 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closerId: acc } as any);
    const { from, to } = resolvePeriod("hoje");
    const r = await salesMargin(acc, from, to);
    expect(r.revenueCents).toBe(10000);
    expect(r.costCents).toBe(4000);
    expect(r.marginCents).toBe(6000);
    expect(r.marginBps).toBe(6000); // 60%
    expect(r.byItem[0]).toMatchObject({ name: "Bola", quantity: 2, costCents: 4000 });
  });
});
```

**Step 2 — Rode e veja falhar.** `-t salesMargin` → FAIL.

**Step 3 — Implemente** (espelha `topItems`, L118-129; usa `closedOrderIds` + `marginBps` de `margin.ts`):
```ts
import { marginBps } from "@/lib/margin";

export interface MarginItem { name: string; quantity: number; revenueCents: number; costCents: number; marginCents: number; }
export interface SalesMargin {
  revenueCents: number; costCents: number; marginCents: number; marginBps: number;
  withoutCostCount: number; byItem: MarginItem[];
}

export async function salesMargin(accountId: string, from: Date, to: Date): Promise<SalesMargin> {
  const ids = await closedOrderIds(accountId, from, to);
  if (!ids.length) return { revenueCents: 0, costCents: 0, marginCents: 0, marginBps: 0, withoutCostCount: 0, byItem: [] };
  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: ids } },
    select: { nameSnapshot: true, unitPriceCents: true, unitCostCents: true, quantity: true },
  });
  const map = new Map<string, MarginItem>();
  let withoutCostCount = 0;
  for (const i of items) {
    const revenue = i.unitPriceCents * i.quantity;
    const cost = (i.unitCostCents ?? 0) * i.quantity;
    if (i.unitCostCents == null) withoutCostCount += i.quantity;
    const cur = map.get(i.nameSnapshot) ?? { name: i.nameSnapshot, quantity: 0, revenueCents: 0, costCents: 0, marginCents: 0 };
    cur.quantity += i.quantity; cur.revenueCents += revenue; cur.costCents += cost;
    cur.marginCents = cur.revenueCents - cur.costCents;
    map.set(i.nameSnapshot, cur);
  }
  const byItem = [...map.values()].sort((a, b) => b.marginCents - a.marginCents);
  const revenueCents = byItem.reduce((s, i) => s + i.revenueCents, 0);
  const costCents = byItem.reduce((s, i) => s + i.costCents, 0);
  return { revenueCents, costCents, marginCents: revenueCents - costCents, marginBps: marginBps({ revenueCents, costCents }), withoutCostCount, byItem };
}
```

**Step 4 — Rota + UI.** Em `reports/route.ts`, dentro do bloco `canSettings` (junto de `commissions`, L28-32),
some `salesMargin(...)` ao `Promise.all` e devolva `margin`. No `ReportsPanel`, adicione um bloco **Margem**
(receita − custo = margem, `marginBps/100`%), visível só ao dono; se `withoutCostCount > 0`, "N itens vendidos
sem custo cadastrado — margem parcial". Tokens de tema.

**Step 5 — Verifique.** `npm test` + `npm run dev`: feche uma comanda com produto que tem custo → Relatórios
mostra a margem; produto sem custo → aparece no aviso de parcial. Skill `verify`.

**Step 6 — Commit.**
```bash
git add src/server/services/sales-report.service.ts src/server/services/sales-report.service.test.ts src/app/api/vendas/reports/route.ts src/components/vendas/ReportsPanel.tsx
git commit -m "feat(catalogo): relatório de margem realizada por período"
```

---

# FASE 12.2 — Código de barras/EAN + busca no caixa

**Resultado:** produtos ganham `barcode` (único por conta); o operador **bipa** no caixa e o item entra na
comanda sem procurar na lista. Compõe a Onda G (append) — **sem** SQL redundante.

---

### Tarefa 12.2.1: schema `CatalogItem.barcode` + catálogo aceita o campo

**Files:**
- Modify: `prisma/manual/2026-07-11-onda-g.sql` (**append**, não sobrescreva)
- Modify: `prisma/schema.prisma` (`CatalogItem.barcode` + `@@unique`)
- Modify: `src/server/services/catalog.service.ts` (DTO + schema + create/update)
- Test: `src/server/services/catalog.service.test.ts` (banco real; **ESTENDA** — testa unicidade por conta)

**Step 1 — SQL (append).** Acrescente ao `onda-g.sql`:
```sql
-- ── 12.2: código de barras/EAN (único por conta; NULLs coexistem) ─────────────
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogItem_accountId_barcode_key"
  ON "CatalogItem"("accountId", "barcode");
```
> No Postgres, NULLs são distintos no índice único → itens sem código convivem (mesmo padrão de `Order.number`).

**Step 2 — Schema + db push.** Em `CatalogItem`: `barcode String?` e, nos `@@`, `@@unique([accountId, barcode])`.
Pare o `next dev`, `npx prisma db push`.

**Step 3 — Teste que falha (banco real).**
```ts
it("barcode é único por conta (P2002 vira erro amigável)", async () => {
  const acc = await makeOwner();
  await createCatalogItem(acc, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
  await expect(createCatalogItem(acc, { name: "B", priceCents: 200, kind: "PRODUTO", barcode: "789" }))
    .rejects.toThrow(/código de barras|já/i);
});
it("contas diferentes podem repetir o mesmo barcode", async () => {
  const a = await makeOwner(); const b = await makeOwner();
  await createCatalogItem(a, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
  await expect(createCatalogItem(b, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" })).resolves.toBeTruthy();
});
```

**Step 4 — Rode e veja falhar.** `-t barcode` → FAIL.

**Step 5 — Implemente.** Em `catalog.service.ts`:
- `CatalogItemDTO` (L6-19) + `toDTO` (L39-49): adicione `barcode: string | null`.
- `stockConfigSchema` (L32-37) OU um campo no `upsertSchema`: adicione `barcode: z.string().trim().max(64).nullish()`
  (normalize vazio→null; barcode faz sentido em qualquer item, mas na UI só aparece p/ `PRODUTO`).
- `createCatalogItem`/`updateCatalogItem`: grave `barcode: cfg.barcode?.trim() || null`. **Converta P2002**
  em erro amigável ("Já existe um item com este código de barras."), como o restante do serviço faz com nomes.

**Step 6 — Rode e veja passar.** `npx vitest run src/server/services/catalog.service.test.ts` → PASS.

**Step 7 — Commit.**
```bash
git add prisma/manual/2026-07-11-onda-g.sql prisma/schema.prisma src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(catalogo): código de barras/EAN por item (único por conta, Onda G)"
```

---

### Tarefa 12.2.2: `findByBarcode` + lookup no caixa (bipar) + campo no CatalogManager

**Files:**
- Modify: `src/server/services/catalog.service.ts` (`findByBarcode`)
- Create: `src/app/api/vendas/catalog/lookup/route.ts` (GET `?barcode=`)
- Test: `src/server/services/catalog.service.test.ts` (banco real; **ESTENDA**)
- Modify: `src/components/vendas/CatalogManager.tsx` (campo Barcode no add/edit de `PRODUTO`)
- Modify: `src/components/vendas/OrderBoard.tsx` (input "bipar" no painel de itens)

**Step 1 — `findByBarcode` (serviço) + teste.**
```ts
it("findByBarcode resolve o item ativo da conta pelo código", async () => {
  const acc = await makeOwner();
  const p = await createCatalogItem(acc, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
  expect((await findByBarcode(acc, "789"))?.id).toBe(p.id);
  expect(await findByBarcode(acc, "000")).toBeNull(); // inexistente
});
```
```ts
export async function findByBarcode(accountId: string, barcode: string): Promise<CatalogItemDTO | null> {
  const code = barcode.trim();
  if (!code) return null;
  const item = await prisma.catalogItem.findFirst({ where: { accountId, barcode: code } });
  return item ? toDTO(item) : null;
}
```
> Sem filtro por `active`: o caixa pode bipar um item inativo e o front decide; ou filtre `active: true` se
> preferir esconder inativos do caixa. Decida e trave num teste.

**Step 2 — Lookup endpoint.** `GET /api/vendas/catalog/lookup?barcode=...` → `getTenantContext` (qualquer
operador, é leitura do caixa), retorna `{ item }` ou 404 `{ error: "Código não encontrado." }`. Espelhe o
handler curto de `catalog/route.ts` (mesma auth), `dynamic = "force-dynamic"`.

**Step 3 — UI do caixa (bipar).** No `OrderItemsPanel` do `OrderBoard` (perto do filtro L451), adicione um
input "Bipar código" que, no `Enter`, faz `GET .../lookup?barcode=` e, achando, chama `addFromCatalog(item.id)`
(reusa o incremento de linha existente L481-489) e limpa o campo; não achando, mostra "Código não encontrado".
`autoFocus` opcional para leitor USB (que digita + Enter). Tokens de tema.

**Step 4 — Campo no CatalogManager.** No bloco `PRODUTO` do add (L517-559) e da edição (L359-395), adicione um
input "Código de barras" ligado a `barcode`; envie no body de POST/PATCH. Mostre o código na linha de leitura
(L412-436) discretamente.

**Step 5 — Verifique.** `npm test` + `npm run dev`: cadastre produto com código → no caixa, bipar/digitar o
código adiciona à comanda; repetir incrementa a linha; código errado avisa. Skill `verify`.

**Step 6 — Commit.**
```bash
git add src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts src/app/api/vendas/catalog/lookup src/components/vendas/CatalogManager.tsx src/components/vendas/OrderBoard.tsx
git commit -m "feat(catalogo): bipar código de barras no caixa (lookup + campo no catálogo)"
```

---

# FASE 12.3 — Variações/grade (SKU flat via `variantGroup`)

**Resultado:** produtos com grade (tamanho/cor) ganham um **rótulo de grupo** (`variantGroup`) para aparecerem
juntos no catálogo e no caixa, sem introduzir um modelo relacional. Cada variação continua uma `CatalogItem`
com seu próprio estoque/preço/barcode. Compõe a Onda G (append).

> **Decisão (do mestre):** `ItemVariant` relacional fica **adiado**. Ver "Decisões travadas". `variantGroup`
> entrega o valor de grade (agrupar/filtrar) com custo mínimo e 100% de reuso.

---

### Tarefa 12.3.1: schema `CatalogItem.variantGroup` + catálogo aceita o campo

**Files:**
- Modify: `prisma/manual/2026-07-11-onda-g.sql` (**append**)
- Modify: `prisma/schema.prisma` (`variantGroup String?` + `@@index([accountId, variantGroup])`)
- Modify: `src/server/services/catalog.service.ts` (DTO + schema + create/update)
- Test: `src/server/services/catalog.service.test.ts` (prisma mock **ou** banco real — asserta persistência)

**Step 1 — SQL (append).**
```sql
-- ── 12.3: agrupamento de grade (SKU flat; ItemVariant relacional adiado) ──────
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "variantGroup" TEXT;
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_variantGroup_idx"
  ON "CatalogItem"("accountId", "variantGroup");
```

**Step 2 — Schema + db push.** `variantGroup String?` em `CatalogItem` + `@@index([accountId, variantGroup])`.
Pare o `next dev`, `npx prisma db push`.

**Step 3 — Teste que falha.**
```ts
it("persiste variantGroup e devolve no DTO", async () => {
  const acc = await makeOwner();
  const p = await createCatalogItem(acc, { name: "Camiseta P", priceCents: 3000, kind: "PRODUTO", variantGroup: "Camiseta" });
  expect(p.variantGroup).toBe("Camiseta");
});
```

**Step 4 — Rode e veja falhar.** → FAIL.

**Step 5 — Implemente.** `CatalogItemDTO` + `toDTO` + schema (`variantGroup: z.string().trim().max(60).nullish()`)
+ create/update gravam `variantGroup?.trim() || null`. Mesmo padrão do `sku`.

**Step 6 — Rode e veja passar.** → PASS.

**Step 7 — Commit.**
```bash
git add prisma/manual/2026-07-11-onda-g.sql prisma/schema.prisma src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(catalogo): agrupamento de grade (variantGroup, SKU flat, Onda G)"
```

---

### Tarefa 12.3.2: UI de grade — agrupar no catálogo e no picker do caixa

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx` (campo "Grupo/Grade" + agrupamento visual)
- Modify: `src/components/vendas/OrderBoard.tsx` (agrupar itens do mesmo `variantGroup` no picker)

**Step 1 — CatalogManager.** Campo opcional "Grupo (grade)" no add/edit de `PRODUTO` (ex.: "Camiseta").
Na listagem, itens com o mesmo `variantGroup` aparecem sob um subcabeçalho (agrupar por `variantGroup`, os
sem grupo seguem soltos). Só apresentação — cada linha continua editável isolada.

**Step 2 — OrderBoard.** No picker (L683-687), agrupe visualmente as opções por `variantGroup` (um cabeçalho
por grupo, itens sem grupo soltos). `CatalogItem` do OrderBoard (L44) passa a carregar `variantGroup`. Nada
muda no `addFromCatalog` — variação continua um `catalogItemId` normal.

**Step 3 — Verifique.** `npm run dev`: cadastre "Camiseta P/M/G" com grupo "Camiseta" → catálogo e caixa as
mostram agrupadas; cada tamanho tem seu preço/estoque/barcode. Skill `verify`.

**Step 4 — Commit.**
```bash
git add src/components/vendas/CatalogManager.tsx src/components/vendas/OrderBoard.tsx
git commit -m "feat(catalogo): grade agrupada no catálogo e no caixa"
```

---

## Verificação de ponta a ponta (antes de fechar)

1. `npm test` inteiro verde + `npx tsc --noEmit` limpo + `npm run lint` sem erros novos.
2. **Valorização/margem:** produto com custo → aba Estoque mostra "Valor em estoque"; feche uma comanda com
   ele → Relatórios (como dono) mostra a Margem; item **sem** custo aparece no aviso de "parcial" em ambos.
3. **Snapshot histórico:** feche uma comanda, **mude o custo** do produto no catálogo → a margem daquela
   comanda **não muda** (usa `unitCostCents` gravado); uma comanda nova usa o custo novo.
4. **Barcode:** cadastre com código; no caixa, bipar/digitar adiciona à comanda; repetir incrementa a linha;
   código inexistente avisa; tentar cadastrar dois itens com o mesmo código na mesma conta → erro amigável;
   contas diferentes podem repetir.
5. **Grade:** "Camiseta P/M/G" no grupo "Camiseta" → agrupadas no catálogo e no picker; estoque/preço/barcode
   por tamanho independentes.
6. **Operador (sem `canSettings`):** vê valorização? — decida: valor de estoque é gestão (dono). Margem/relatório
   **só dono** (já gateado). Sem 500 para operador.

**PROD (após o merge):** aplicar `prisma/manual/2026-07-11-onda-g.sql` inteiro no Supabase SQL Editor (idempotente,
`IF NOT EXISTS` — pode reaplicar) **antes** do deploy de código; depois deploy web via Vercel CLI
([[vercel-hobby-push-block]]). Sem worker novo, sem env novo. **Não** rode SQL redundante com migration
versionada ([[prod-schema-drift-destravar]]).

---

## Riscos e notas

- **Custo ausente vaza margem otimista.** Sem `costCents`, o item entra com custo 0 → margem = 100%. Mitigado
  por `withoutCostCount` + aviso "parcial" em toda tela de valor/margem. Nunca exiba um total como se fosse
  completo quando há itens sem custo.
- **Snapshot vs live-join.** A margem realizada usa `OrderItem.unitCostCents` (histórico). Comandas **antigas**
  (fechadas antes desta entrega) têm `unitCostCents = null` → contam como custo 0 no período; o aviso de
  parcial cobre isso. Aceitável (não há custo histórico a recuperar).
- **Barcode e leitor USB.** O leitor "digita" o EAN + Enter num input focado. O campo de bipar deve tratar
  `Enter` e tolerar espaços/quebras; não dependa de scanner específico. Sem custo de onboarding (é só um input).
- **Grade flat tem limite.** `variantGroup` agrupa, mas não modela matriz cor×tamanho nem "variações de um
  produto-pai". Se a demanda por isso aparecer, promover a `ItemVariant` é uma **onda futura** — este plano
  deixa o caminho aberto (barcode/estoque já por linha migram naturalmente).
- **Onda G composta.** As três fases escrevem no **mesmo** `onda-g.sql`. Nunca duplique um `ALTER` já presente
  nem crie um segundo arquivo — colisão manual×migration trava deploy ([[prod-schema-drift-destravar]]).
- **Testes de integração exigem `DATABASE_URL` de teste** (Postgres real), como `order`/`catalog`/`sales-report`
  já exigem. Sem ele, cubra o máximo com os puros (`margin.test.ts`) e prisma-mock (`stock-valuation`), + skill
  `verify`.

---

## Ordem de entrega recomendada
1. **12.1.1–12.1.2** (margem pura + valorização) — **sem schema**, ship isolado, valor imediato pro varejo.
2. **12.1.3–12.1.4** (snapshot de custo + margem realizada) — abre a Onda G; é o coração da margem.
3. **12.2** (barcode) — independe da margem; alto valor operacional no caixa.
4. **12.3** (grade) — por último; puro reuso, só agrupa o que as fases anteriores já entregam por linha.
