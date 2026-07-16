# Estorno / reabertura de comanda (reverte baixa de estoque, trilha de auditoria)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 4, Onda B).

**Goal:** hoje uma comanda `FECHADA` é **terminal** — erro de operador (item errado, valor errado,
pagamento trocado) não tem conserto. Este plano adiciona **estorno** (cancelar uma comanda fechada,
revertendo a baixa de estoque e tirando-a da receita) com **motivo obrigatório** e **trilha de
auditoria**, e opcionalmente **reabrir** (voltar para `ABERTA` para corrigir e fechar de novo).

**Architecture:** novo valor `CANCELADA` no enum `OrderStatus`. `voidOrder(accountId, orderId, reason,
byId)` roda numa transação: marca a comanda `CANCELADA` (+`canceledAt`/`canceledReason`/`canceledById`)
e **reverte a baixa de estoque** criando movimentos de compensação (`ENTRADA` que estorna cada `SAIDA`
ligada à comanda) — o ledger `StockMovement` continua **append-only** (nunca apaga, compensa).
`reopenOrder` é um caso especial que volta para `ABERTA` (reverte estoque, limpa `closedAt`/`number`)
para reedição. Relatórios e conferência de caixa passam a **excluir** comandas `CANCELADA`. Reusa
`order.service`, `stock.service` (`applyOrderStockExit` tem o inverso), `sales-report`/`sales-history`.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · Vitest.

**Escopo (o que NÃO entra):** estorno **parcial** (item a item numa comanda fechada) — v1 estorna a
comanda inteira; estorno de cobrança Pix no gateway (a `Sale`/gateway é outro fluxo — [[financeiro-billing-gate]]);
estorno fiscal (iniciativa 13).

**Decisões de produto:**
- **Motivo obrigatório** — todo estorno registra `canceledReason` e quem fez (`canceledById`).
- **Ledger nunca apaga** — reversão de estoque é **movimento de compensação**, não delete (auditoria
  íntegra, espelha o padrão do `Payment` que prevê lançamento negativo — [schema.prisma:199-201](../../prisma/schema.prisma#L199-L201)).
- **Só dono/gerente estorna** (`canSettings`) — é ação sensível.
- **Reabrir vs estornar:** estornar = anula (fica `CANCELADA` no histórico); reabrir = volta pra
  `ABERTA` pra corrigir (sequência de `number` fica com buraco — aceitável, documentar).

---

## Coordenação (Onda B — compartilhada com Sessão de caixa)

- **`prisma/schema.prisma`** e **`prisma/manual/2026-07-06-onda-b.sql`** — Sessão de caixa
  (`2026-07-06-sessao-de-caixa.md`) é Onda B e pode ter criado o `onda-b.sql`. **Acrescente**, não
  sobrescreva. `npx prisma validate` após integrar.
- **Conferência de caixa:** comanda estornada **dentro de um turno** deve sair do "esperado em
  dinheiro" daquela sessão — a query `sessionSummary` (do plano de caixa) já deve filtrar
  `status != CANCELADA`. Se aquele plano já rodou, ajuste o filtro lá; senão, deixe a nota para ele.

---

## Contexto do código existente (leia antes de começar)

- **Fechamento e baixa:** [order.service.ts:~131](../../src/server/services/order.service.ts#L131) —
  `closeOrder`; [stock.service.ts:~91](../../src/server/services/stock.service.ts#L91) —
  `applyOrderStockExit` (o inverso vive aqui como `reverseOrderStockExit`).
- **Enum:** [schema.prisma:52-55](../../prisma/schema.prisma#L52-L55) — `OrderStatus { ABERTA FECHADA }`
  ganha `CANCELADA`.
- **Ledger:** `StockMovement` ([schema.prisma:327](../../prisma/schema.prisma#L327)) — `kind`
  (ENTRADA/SAIDA/AJUSTE), `orderId`, `delta`, `balanceAfter`. A compensação é um `ENTRADA` com
  `orderId` da comanda e `reason` "estorno".
- **Relatórios/extrato:** [sales-report.service.ts](../../src/server/services/sales-report.service.ts),
  [sales-history.service.ts](../../src/server/services/sales-history.service.ts) — filtrar `CANCELADA`.
- **UI extrato:** [SalesHistoryPanel.tsx](../../src/components/vendas/SalesHistoryPanel.tsx) — ação
  "Estornar" por linha.
- **PROD drift** ([[prod-schema-drift-destravar]]): `ALTER TYPE` + colunas → SQL idempotente Onda B.

---

## Visão geral das fases

- **Fase 1** — Schema: `CANCELADA` + colunas de auditoria (Onda B).
- **Fase 2** — Reversão de estoque (`reverseOrderStockExit`) + `voidOrder`/`reopenOrder` (TDD).
- **Fase 3** — API (estornar / reabrir).
- **Fase 4** — Relatórios/extrato excluem canceladas + UI de estorno.

---

# FASE 1 — Schema

## Task 1.1: `OrderStatus += CANCELADA` + auditoria (Onda B)
**Files:** Modify `prisma/schema.prisma`; append `prisma/manual/2026-07-06-onda-b.sql`.
- Enum: `enum OrderStatus { ABERTA FECHADA CANCELADA }`.
- Em `Order`: `canceledAt DateTime?`, `canceledReason String?`, `canceledById String?` (+ relação
  opcional p/ `User`, ou só o id string — seguir o padrão de `openedById`).
- push dev (pare o `next dev` — [[prisma-generate-dev-server-lock]]).
- Append idempotente ao `onda-b.sql`:
```sql
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CANCELADA';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledById" TEXT;
```
> ⚠️ `ALTER TYPE ... ADD VALUE` **não** roda dentro de bloco de transação em algumas versões do
> Postgres — aplicar essa linha **isolada** no SQL Editor, antes das outras. Commit.

---

# FASE 2 — Reversão + serviço

## Task 2.1: `reverseOrderStockExit` — TDD
**Files:** Modify `src/server/services/stock.service.ts`; Test.
- **Contexto:** para cada `SAIDA` da comanda (produtos rastreados), cria um `ENTRADA` de compensação
  (`delta` positivo igual, `balanceAfter` recalculado, `reason` "estorno de comanda", mesmo `orderId`)
  e **incrementa** o `stockQty`. Idempotente: não reverte duas vezes (checar se já há compensação, ou
  só rodar dentro do `voidOrder` que muda o status atômico).
- Test (falha primeiro): fecha comanda com produto rastreado (estoque cai), `reverseOrderStockExit` →
  estoque volta ao valor original e existe um `ENTRADA` ligado à comanda. Commit.

## Task 2.2: `voidOrder` + `reopenOrder` — TDD
**Files:** Modify `src/server/services/order.service.ts`; Test.
- Test (falha primeiro):
  - `voidOrder(accountId, id, reason, byId)`: só de `FECHADA`; vira `CANCELADA` com auditoria; estoque
    revertido; `updateMany` guardado em `status=FECHADA` (evita corrida/duplo estorno). Reason vazio
    lança.
  - `reopenOrder(accountId, id, byId)`: só de `FECHADA`; volta `ABERTA`, limpa `closedAt`/`payment`/
    `number`/tenders, reverte estoque (será re-baixado no próximo fechamento).
- Impl transacional reusando `reverseOrderStockExit`. Commit.

---

# FASE 3 — API

## Task 3.1: Rotas de estorno/reabertura
**Files:** Create `src/app/api/vendas/orders/[id]/void/route.ts` e `.../reopen/route.ts`.
- Espelham `catalog/[id]` (force-dynamic, `getTenantContext`, 401, **403 sem `canSettings`**, zod
  `{ reason }` p/ void, try/catch → `{ error }`). Commit.

---

# FASE 4 — Relatórios e UI

## Task 4.1: Excluir `CANCELADA` de relatórios/extrato — TDD
**Files:** Modify `sales-report.service.ts`, `sales-history.service.ts`; Testes.
- Todos os agregados (faturamento, ticket, por meio, top itens) e o extrato passam a filtrar
  `status: "FECHADA"` (ou `status != "CANCELADA"` onde já filtra por `closedAt`). O extrato pode ter
  um filtro opcional "mostrar canceladas" (view-only, marcadas). Testes + commit.
- **Coordenação:** se a **conferência de caixa** já existir, garanta que `sessionSummary` também
  exclua `CANCELADA` (ver nota de coordenação).

## Task 4.2: UI de estorno no extrato
**Files:** Modify `src/components/vendas/SalesHistoryPanel.tsx`.
- Ação "Estornar" por linha (só `canEdit`/`canSettings`), modal pedindo **motivo**, confirmação forte
  ("isso anula a venda e devolve o estoque"). Linha estornada aparece riscada/tag "Estornada" com o
  motivo. Verificação E2E + commit.
- (Opcional) "Reabrir" quando fizer sentido no fluxo — pode ficar como fast-follow.

---

## Verificação de ponta a ponta

1. Fechar comanda com produto rastreado (estoque cai de 10→8).
2. Estornar com motivo "valor errado" → status `CANCELADA`, estoque volta a 10, `ENTRADA` de estorno
   no ledger, auditoria preenchida.
3. Faturamento do dia **não** conta a estornada; extrato mostra riscada com o motivo.
4. Estorno sem motivo → recusado. Estornar duas vezes → segunda recusada (guard).
5. (Se caixa pronto) estorno dentro do turno → sai do esperado da sessão.
6. `npx vitest run src/server/services/order.service.test.ts src/server/services/stock.service.test.ts
   src/server/services/sales-report*` verde + `npx tsc --noEmit`.
7. PROD: aplicar `2026-07-06-onda-b.sql` (a linha do `ALTER TYPE` isolada primeiro); Caixa sem 500.

---

## Riscos e notas

- **`ALTER TYPE ADD VALUE` fora de transação** — aplicar isolado no Supabase antes das colunas
  ([[prod-schema-drift-destravar]]).
- **Ledger append-only** — reversão é compensação, nunca delete; mantém auditoria e reconciliação de
  `stockQty` íntegras.
- **Idempotência do estorno** — guard `updateMany where status=FECHADA` garante uma reversão só.
- **Buraco na sequência de `number`** ao reabrir — aceitável e documentado (o cupom já foi impresso;
  reabrir é reedição de exceção).
- **Interação com caixa** — comanda estornada no turno deve sair do esperado; coordenar a query da
  conferência (Onda B).
- **Estorno parcial** e **estorno de Pix no gateway** são escopo futuro — não confundir com este
  estorno operacional de comanda.
