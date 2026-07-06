# POS financeiro — desconto, acréscimo/taxa, gorjeta, troco, quantidade e multi-pagamento

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 2, Onda A).

**Goal:** dar à comanda a **camada financeira entre os itens e o total** que hoje não existe. Hoje o
total é só `Σ preço×qtd` e o fechamento aceita **um único** meio de pagamento — tudo o mais precisa
ser falsificado como "linha avulsa" (a UI até sugere "ex.: Gorjeta"). Este plano adiciona:
**quantidade editável**, **desconto** (comanda e linha), **acréscimo / taxa de serviço**, **gorjeta**
estruturada, **valor recebido + troco** (dinheiro) e **pagamento em múltiplos meios / parcial**.

**Architecture:** o total continua **derivado** — nunca desnormalizado. `orderTotalCents` passa a
somar itens e aplicar os ajustes do `Order` (`- desconto + acréscimo + gorjeta`). O pagamento deixa
de ser um enum único no `Order` e vira **N linhas** num model novo `OrderTender` (`method`,
`amountCents`); a compatibilidade com o fluxo antigo é mantida (fechar com um meio = um tender). O
troco é derivado (`amountTendered - total` quando há dinheiro). Reusa `order.service`, `money.ts`,
`OrderBoard.tsx` e as rotas de `/api/vendas/orders`.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · TailwindCSS · Vitest.

**Escopo (o que NÃO entra):** parcelamento no cartão com NSU/bandeira (só registra o valor no meio
CARTAO); comissão sobre desconto (iniciativa 9); imposto/taxa fiscal (iniciativa 13); desconto por
regra automática/cupom promocional (só desconto manual, valor ou %).

**Decisões de produto:**
- **Total sempre derivado.** Desconto/acréscimo/gorjeta são ajustes sobre `Σ itens`, recalculados a
  cada leitura — igual o total de hoje.
- **Desconto em valor OU %** — guardado sempre em centavos (o % é resolvido na borda).
- **Não trava o fechamento** por soma de tenders diferente do total: permite **parcial** (soma <
  total → comanda fica com saldo, mas fecha se o operador confirmar) e **excedente em dinheiro** vira
  troco. Dinheiro nunca é bloqueado por aritmética ([[caixa-despesas-reposicionamento]]).
- **Quantidade editável** no item — resolve o hack de "repetir linha" (a UI hoje sempre manda qtd 1).

---

## Coordenação (Onda A — execução possivelmente paralela com Impressão)

- **`prisma/schema.prisma`** e **`prisma/manual/2026-07-05-onda-a.sql`** — o plano de **impressão**
  (`2026-07-05-impressao-comanda.md`) já criou o `onda-a.sql` com `Order.number`/`CatalogItem.printSector`.
  **Acrescente** as colunas deste plano ao mesmo arquivo (não sobrescreva). Rode `npx prisma validate`
  após integrar.
- **`src/components/vendas/OrderBoard.tsx`** — impressão adiciona botão "Imprimir"; este plano mexe no
  **painel de fechamento** e no **item**. Áreas diferentes; fazer merge, não conflito.
- Fora isso, sem sobreposição.

---

## Contexto do código existente (leia antes de começar)

- **Total derivado:** [order.service.ts:~17](../../src/server/services/order.service.ts#L17) —
  `orderTotalCents(items)`. É aqui que os ajustes entram.
- **Adicionar/remover item:** `addItem` (~L86-107, `quantity` já é `Int`, forçado a `>=1`),
  `removeItem`. Falta **editar** quantidade.
- **Fechamento:** `closeOrder` (~L131) — `updateMany` atômico guardado em `status=ABERTA`, seta
  `closedAt`, chama `applyOrderStockExit`. O `payment` é setado aqui.
- **API:** [orders/[id]/route.ts:~20](../../src/app/api/vendas/orders/[id]/route.ts#L20) — `closeSchema`
  (`{ payment, note? }`). Vira `{ tenders[], discount?, surcharge?, tip?, amountTendered?, note? }`.
- **UI de fechamento:** [OrderBoard.tsx:~596-607](../../src/components/vendas/OrderBoard.tsx#L596-L607) —
  `<select>` de pagamento + botão fechar (desabilitado com 0 itens). Adicionar linha avulsa ~L579,
  add do catálogo ~L429 (sempre qtd 1 — trocar por stepper).
- **Relatório por meio:** [sales-report.service.ts:~23](../../src/server/services/sales-report.service.ts#L23) —
  `revenueByPayment`. Passa a somar por **tender**, não pelo `Order.payment`.
- **Dinheiro:** [money.ts](../../src/lib/money.ts) — `parseBRLToCents`/`formatCentsBRL`, só na borda.
- **Model:** [schema.prisma:282-321](../../prisma/schema.prisma#L282-L321) — `Order`, `OrderItem`,
  enum `OrderPayment` (DINHEIRO/PIX/CARTAO/OUTRO — **reusar**).
- **PROD schema drift** ([[prod-schema-drift-destravar]]): colunas novas → SQL idempotente na Onda A.

---

## Visão geral das fases

- **Fase 1** — Quantidade editável no item (schema já tem `quantity`; só serviço/API/UI).
- **Fase 2** — Ajustes no `Order` (desconto/acréscimo/gorjeta) + `orderTotalCents` recalculado (TDD).
- **Fase 3** — `OrderTender` (multi-pagamento) + valor recebido/troco + fechamento novo.
- **Fase 4** — Relatórios e extrato refletem tenders e ajustes.

Cada fase é entregável e reversível.

---

# FASE 1 — Quantidade editável

## Task 1.1: Serviço `setItemQuantity` — TDD
**Files:** Modify `src/server/services/order.service.ts`; Test `order.service.test.ts`.
- Test (falha primeiro): abrir comanda, addItem, `setItemQuantity(item, 3)` → item com qtd 3 e total
  da comanda = 3×preço. `quantity < 1` é rejeitado. Só em comanda `ABERTA` (fechada lança).
- Impl: `setItemQuantity(accountId, orderId, itemId, qty)` — valida posse + `ABERTA`, `Math.max(1, floor)`,
  `update`. Commit.

## Task 1.2: API `PATCH .../items/[itemId]`
**Files:** Create/Modify `src/app/api/vendas/orders/[id]/items/[itemId]/route.ts`.
- Espelha o padrão de `catalog/[id]` (force-dynamic, `getTenantContext`, 401, zod `{ quantity }`,
  try/catch → `{ error }`). Commit.

## Task 1.3: Stepper de quantidade na UI
**Files:** Modify `src/components/vendas/OrderBoard.tsx` (`OrderPanel`).
- Substituir "adicionar sempre qtd 1" por um stepper `− N +` por linha que chama o PATCH; `addFromCatalog`
  de um item já na comanda **incrementa** em vez de criar linha nova (checar por `catalogItemId`).
  Verificação visual + commit.

---

# FASE 2 — Ajustes financeiros no total

## Task 2.1: Colunas de ajuste no schema (Onda A)
**Files:** Modify `prisma/schema.prisma` (`Order`); append `prisma/manual/2026-07-05-onda-a.sql`.
- Em `Order`: `discountCents Int?`, `surchargeCents Int?`, `tipCents Int?`, `amountTenderedCents Int?`,
  `changeCents Int?`, `tableLabel String?`.
- push dev (pare o `next dev` — [[prisma-generate-dev-server-lock]]).
- Append idempotente ao `onda-a.sql`:
```sql
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "surchargeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tipCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "amountTenderedCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "changeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tableLabel" TEXT;
```
- Commit.

## Task 2.2: `orderTotalCents` aplica os ajustes — TDD
**Files:** Modify `src/server/services/order.service.ts`; Test `order.service.test.ts`.
- **Contexto:** hoje `orderTotalCents(items)` só soma. Passa a receber os ajustes.
- Test (falha primeiro): `orderTotalCents({ items, discountCents, surchargeCents, tipCents })`:
  - `Σ itens = 10000`, desconto 1500 → 8500.
  - + acréscimo 850 (taxa 10%) → 9350. + gorjeta 500 → 9850.
  - desconto não deixa total < 0 (clampa em 0).
- Impl: assinatura nova `orderTotalCents({ items, discountCents = 0, surchargeCents = 0, tipCents = 0 })`
  = `max(0, Σ - desconto) + acréscimo + gorjeta`. **Atualize todos os call sites** (fechamento,
  listagem, relatório) para passar os ajustes do `Order`. Commit.

## Task 2.3: Serviço `setOrderAdjustments` + API
**Files:** Modify `order.service.ts`; Modify `orders/[id]/route.ts` (PATCH aceita ajustes).
- `setOrderAdjustments(accountId, orderId, { discountCents?, surchargeCents?, tipCents?, tableLabel? })`
  — só `ABERTA`; guarda desconto em centavos (a UI resolve % → centavos na borda). Teste + commit.

## Task 2.4: UI dos ajustes no painel de fechamento
**Files:** Modify `src/components/vendas/OrderBoard.tsx`.
- No `OrderPanel`, acima do total: campos "Desconto" (R$ ou %), "Taxa de serviço" (R$ ou %, com atalho
  10%), "Gorjeta". Recalcula o total exibido. Usa `parseBRLToCents`/`formatCentsBRL` na borda.
  Verificação visual + commit.

---

# FASE 3 — Multi-pagamento e troco

## Task 3.1: Model `OrderTender` (Onda A)
**Files:** Modify `prisma/schema.prisma`; append `onda-a.sql`.
- Novo model:
```prisma
model OrderTender {
  id          String       @id @default(cuid())
  orderId     String
  order       Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  method      OrderPayment
  amountCents Int
  createdAt   DateTime     @default(now())
  @@index([orderId])
}
```
- Adicione a relação inversa `tenders OrderTender[]` no `Order`. Mantenha `Order.payment` (retrocompat:
  quando houver 1 tender, espelhe o método ali para não quebrar leituras antigas/relatório).
- push dev + append SQL idempotente (`CREATE TABLE IF NOT EXISTS "OrderTender" (...)` + índice). Commit.

## Task 3.2: `closeOrder` aceita tenders + troco — TDD
**Files:** Modify `order.service.ts`; Test `order.service.test.ts`.
- **Contexto:** a transação de fechamento cria os tenders, calcula `changeCents` e mantém `closedAt` +
  baixa de estoque + `Order.number` (do plano de impressão) intactos.
- Test (falha primeiro):
  - Fechar com `tenders=[{DINHEIRO, 10000}]`, total 9850, `amountTendered=10000` → `changeCents=150`,
    `Order.payment=DINHEIRO`.
  - Fechar com `tenders=[{PIX,5000},{DINHEIRO,4850}]` → soma 9850, sem troco, `payment` = método do
    maior tender (ou "OUTRO" p/ misto — decidir e testar).
  - Parcial `tenders=[{PIX,5000}]` com `allowPartial=true` → fecha, saldo registrado; sem a flag → lança.
  - Guard de duplo-fechamento continua (updateMany em `status=ABERTA`).
- Impl dentro da transação existente. `changeCents = max(0, amountTendered - total)` só quando há
  DINHEIRO. Commit.

## Task 3.3: API de fechamento novo
**Files:** Modify `src/app/api/vendas/orders/[id]/route.ts`.
- `closeSchema` vira `{ tenders: [{method, amountCents}], amountTenderedCents?, note?, allowPartial? }`.
  Retrocompat: se vier o antigo `{ payment }`, converte para um tender. Zod + try/catch. Commit.

## Task 3.4: UI de multi-pagamento + troco
**Files:** Modify `src/components/vendas/OrderBoard.tsx`.
- Painel de fechamento: lista de linhas de pagamento (método + valor, "+ adicionar meio"), campo
  "Valor recebido" (dinheiro) mostrando **troco** ao vivo, e o **saldo** (total − soma dos meios).
  Botão fechar habilita com saldo 0 ou, com saldo > 0, pede confirmação "fechar parcial?".
  Verificação E2E do troco + commit.

---

# FASE 4 — Relatórios e extrato

## Task 4.1: `revenueByPayment` soma por tender — TDD
**Files:** Modify `src/server/services/sales-report.service.ts`; Test correspondente.
- Passa a agregar `OrderTender.amountCents` por `method` no período (não `Order.payment`). Comanda com
  2 meios aparece nos dois. Teste + commit.

## Task 4.2: Extrato e recibo mostram ajustes
**Files:** Modify `src/components/vendas/SalesHistoryPanel.tsx`; Modify `src/lib/receipt/model.ts`
(do plano de impressão, se já existir).
- Linha do extrato mostra desconto/acréscimo quando != 0. O `buildReceiptModel` ganha as linhas de
  **Subtotal / Desconto / Taxa / Gorjeta / Total / Troco / Formas de pagamento**. Se o plano de
  impressão ainda não foi feito, deixe um TODO marcado (as duas iniciativas são da Release 1).
  Commit.

---

## Verificação de ponta a ponta

1. Comanda: 2 itens, ajustar qtd de um para 3 → total sobe.
2. Aplicar desconto R$15 e taxa 10% → total recalcula certo.
3. Fechar com PIX R$50 + Dinheiro (recebido R$60, saldo R$X) → troco calculado, comanda fecha.
4. Extrato mostra a comanda; `revenueByPayment` distribui nos dois meios.
5. Recibo (se impressão pronta) traz subtotal/desconto/taxa/total/troco/meios.
6. `npx vitest run src/server/services/order.service.test.ts src/server/services/sales-report*` verde +
   `npx tsc --noEmit`.
7. PROD: aplicar `2026-07-05-onda-a.sql`; abrir Caixa sem 500.

---

## Riscos e notas

- **Total derivado é invariante** — nunca gravar total desnormalizado; sempre `orderTotalCents`.
- **Retrocompat do `Order.payment`** — manter espelhado para não quebrar relatório/extrato antigos até
  a Fase 4 migrar tudo para tenders.
- **Parcial** é decisão consciente (não travar dinheiro); deixar explícito na UI ("fechar parcial").
- **Desconto abusivo/negativo** — clampar total em 0; validar desconto ≤ subtotal no serviço.
- **Onda A** compartilhada com Impressão — respeitar o merge do `onda-a.sql` e do `OrderBoard.tsx`.
