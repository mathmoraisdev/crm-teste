# Sessão de caixa — abrir/fechar turno, fundo de troco, sangria/suprimento, conferência

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 3, Onda B).

**Goal:** dar ao Caixa o conceito de **turno conferível**. Hoje os relatórios são só por período de
calendário (Hoje/7d/Mês) — é impossível **fechar um turno** e conferir a gaveta. Este plano adiciona:
**abrir caixa** com fundo de troco, registrar **sangria** (retirada) e **suprimento** (reforço),
**fechar caixa** com conferência cega (valor contado vs esperado), e um **relatório de conferência**
por sessão.

**Architecture:** dois models novos. `CashSession` (aberta/fechada, `openingFloatCents`,
`closingCountedCents`, `openedById`/`closedById`, `openedAt`/`closedAt`, `status`). `CashMovement`
(SANGRIA/SUPRIMENTO, `amountCents`, `reason`) ligado à sessão. Toda comanda fechada carimba o
`cashSessionId` da sessão **aberta do operador**. O "esperado em dinheiro" é **derivado**:
`fundo + Σ vendas em dinheiro + Σ suprimentos − Σ sangrias`. Reusa `order.service` (fechamento),
`money.ts`, e o `VendasWorkspace`/`OrderBoard`.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · TailwindCSS · Vitest.

**Escopo (o que NÃO entra):** múltiplas gavetas/terminais por sessão (uma sessão = um operador/turno);
conferência por meio não-dinheiro (cartão/Pix conciliam fora); fechamento automático por horário.

**Decisões de produto:**
- **Não trava a venda sem sessão aberta.** Se não há sessão, a comanda fecha mesmo assim (dinheiro
  nunca é bloqueado — [[caixa-despesas-reposicionamento]]); fica sem `cashSessionId` e aparece como
  "fora de sessão" no relatório. A sessão é ferramenta de conferência, não trava operacional.
- **Conferência cega:** ao fechar, o operador digita o valor contado **antes** de ver o esperado; o
  sistema mostra a **diferença** (sobra/falta). Reduz "ajuste pra bater".
- **Sessão é por operador** (`openedById`); um dono/gerente pode fechar a de outro (`canSettings`).
- **Dinheiro** é o foco da conferência; cartão/Pix entram no relatório como informativo.

---

## Coordenação (Onda B — compartilhada com Estorno de comanda)

- **`prisma/schema.prisma`** e **`prisma/manual/2026-07-06-onda-b.sql`** — o plano de **Estorno**
  (`2026-07-06-estorno-comanda.md`) também é Onda B e cria/usa o mesmo `onda-b.sql`. **Acrescente** ao
  arquivo, não sobrescreva. `npx prisma validate` após integrar.
- Depende **conceitualmente** do **POS financeiro** (`2026-07-05-pos-financeiro.md`): o "esperado em
  dinheiro" usa os **tenders** por DINHEIRO. Fazer **depois** dele. Se ainda não houver tenders, caia
  no `Order.payment == DINHEIRO` como fallback (marcar TODO).

---

## Contexto do código existente (leia antes de começar)

- **Fechamento:** [order.service.ts:~131](../../src/server/services/order.service.ts#L131) — `closeOrder`.
  É onde a comanda passa a carimbar `cashSessionId` (Task 2.x).
- **Tenders (POS financeiro):** `OrderTender` — fonte do "vendas em dinheiro" da conferência.
- **Workspace/abas:** [VendasWorkspace.tsx](../../src/components/vendas/VendasWorkspace.tsx) — padrão de
  abas do Caixa (Comandas/Catálogo/Estoque/Despesas/Relatórios). A barra de sessão fica no topo do
  `OrderBoard`, não como aba nova (é estado do turno, não um relatório).
- **Padrão de ledger imutável:** `StockMovement` ([schema.prisma:327](../../prisma/schema.prisma#L327))
  e `Payment` — `CashMovement` espelha (append-only, `amountCents`, `reason`, `createdById`).
- **Dinheiro:** [money.ts](../../src/lib/money.ts).
- **Auth/permesão:** rotas espelham `catalog/[id]/route.ts` (401 sem sessão; abrir/fechar/sangria
  exigem operador logado; fechar sessão de outro exige `canSettings`).
- **PROD drift** ([[prod-schema-drift-destravar]]): models novos → SQL idempotente na Onda B.

---

## Visão geral das fases

- **Fase 1** — Models + `cash-session.service` (abrir/fechar/movimento/esperado), TDD.
- **Fase 2** — Fechamento de comanda carimba `cashSessionId` da sessão aberta.
- **Fase 3** — API (abrir/fechar/sangria/suprimento/estado atual).
- **Fase 4** — UI: barra "Caixa aberto/fechado" + modais + tela de conferência.

---

# FASE 1 — Modelos e serviço

## Task 1.1: `CashSession` + `CashMovement` no schema (Onda B)
**Files:** Modify `prisma/schema.prisma`; Create `prisma/manual/2026-07-06-onda-b.sql`.
- Models:
```prisma
enum CashSessionStatus { ABERTA FECHADA }
enum CashMovementKind  { SANGRIA SUPRIMENTO }

model CashSession {
  id                 String            @id @default(cuid())
  accountId          String
  account            User              @relation("CashSessionAccount", fields: [accountId], references: [id], onDelete: Cascade)
  status             CashSessionStatus @default(ABERTA)
  openingFloatCents  Int               @default(0)   // fundo de troco
  closingCountedCents Int?                            // contado na conferência (cego)
  openedById         String
  closedById         String?
  openedAt           DateTime          @default(now())
  closedAt           DateTime?
  note               String?
  movements          CashMovement[]
  orders             Order[]
  @@index([accountId, status])
}

model CashMovement {
  id          String          @id @default(cuid())
  sessionId   String
  session     CashSession     @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  kind        CashMovementKind
  amountCents Int
  reason      String?
  createdById String
  createdAt   DateTime        @default(now())
  @@index([sessionId])
}
```
- Em `Order`: `cashSessionId String?` + relação; adicione as relações inversas no `User`
  (`cashSessions`) e a `Order.cashSession`.
- push dev (pare o `next dev`). Crie `onda-b.sql` idempotente (`CREATE TABLE IF NOT EXISTS` para as duas
  tabelas + `CREATE TYPE` guardado por `DO $$ ... IF NOT EXISTS` p/ os enums + `ALTER TABLE "Order" ADD
  COLUMN IF NOT EXISTS "cashSessionId" TEXT`). Commit.

## Task 1.2: `cash-session.service` — abrir/fechar/movimento (TDD)
**Files:** Create `src/server/services/cash-session.service.ts`; Test co-locado.
- `openSession(accountId, openedById, openingFloatCents)` — recusa se já há sessão `ABERTA` na conta
  (teste). `addMovement(sessionId, kind, amountCents, reason, createdById)`. `closeSession(accountId,
  sessionId, closedById, countedCents)` — só de sessão `ABERTA`, grava `closingCountedCents`/`closedAt`.
- Testes de posse/escopo + estados. Commit.

## Task 1.3: `computeExpectedCash` — conferência derivada (PURO + query) — TDD
**Files:** Modify `cash-session.service.ts`; Test.
- **PURA** `expectedCashCents({ openingFloatCents, cashSalesCents, suprimentosCents, sangriasCents })`
  = fundo + vendas − sangrias + suprimentos. Teste isolado.
- **Query** `sessionSummary(accountId, sessionId)` — soma vendas em **dinheiro** (via `OrderTender`
  method DINHEIRO das comandas com esse `cashSessionId`; fallback `Order.payment`), soma movimentos,
  chama a pura, e devolve `{ expected, counted, diff }`. Teste de integração. Commit.

---

# FASE 2 — Comanda dentro da sessão

## Task 2.1: `closeOrder` carimba a sessão aberta
**Files:** Modify `src/server/services/order.service.ts`; Test.
- Na transação de fechamento, buscar a sessão `ABERTA` da conta e gravar `cashSessionId` (se houver;
  senão null = "fora de sessão"). Teste: com sessão aberta a comanda referencia; sem sessão fecha
  igual, `cashSessionId=null`. Commit.

---

# FASE 3 — API

## Task 3.1: Rotas de sessão
**Files:** Create `src/app/api/vendas/cash-session/route.ts` (GET estado atual + POST abrir),
`.../cash-session/[id]/close/route.ts`, `.../cash-session/[id]/movement/route.ts`.
- Espelham `catalog/[id]` (force-dynamic, `getTenantContext`, 401, zod, try/catch). Abrir/movimento =
  operador logado; fechar sessão de outro operador = `canSettings`. Commit.

---

# FASE 4 — UI

## Task 4.1: Barra de sessão no topo do OrderBoard
**Files:** Modify `src/components/vendas/OrderBoard.tsx` (ou um `CashSessionBar.tsx` novo).
- Mostra "Caixa fechado — [Abrir caixa]" ou "Caixa aberto às HH:MM · [Sangria] [Suprimento] [Fechar
  caixa]". Modal de abrir pede fundo de troco. Verificação visual + commit.

## Task 4.2: Modais de sangria/suprimento + fechamento cego
**Files:** Modify o mesmo componente.
- Sangria/Suprimento: valor + motivo → POST movement.
- Fechar: primeiro pede o **valor contado** (sem mostrar o esperado), depois revela
  esperado/contado/**diferença** (sobra/falta destacada com token de cor — [[design-tokens-dark-theme]]).
  Verificação E2E + commit.

## Task 4.3: Relatório da sessão
**Files:** Modify `src/components/vendas/ReportsPanel.tsx` (ou nova subaba "Sessões").
- Lista sessões fechadas com fundo, vendas por meio, sangrias/suprimentos, esperado × contado × diff.
  Commit.

---

## Verificação de ponta a ponta

1. Abrir caixa com fundo R$100.
2. Fechar 2 comandas (uma em dinheiro, uma em Pix) → a de dinheiro entra no esperado.
3. Sangria R$50 (motivo "depósito") → esperado cai.
4. Fechar caixa: digitar contado → ver esperado e diferença.
5. Sem sessão aberta, fechar comanda → fecha, marcada "fora de sessão".
6. `npx vitest run src/server/services/cash-session.service.test.ts src/server/services/order.service.test.ts`
   verde + `npx tsc --noEmit`.
7. PROD: aplicar `2026-07-06-onda-b.sql`; Caixa abre sem 500.

---

## Riscos e notas

- **Enum em PROD** — `CREATE TYPE` precisa de guarda idempotente (`DO $$ BEGIN ... EXCEPTION WHEN
  duplicate_object THEN null; END $$;`). Não duplicar com migration versionada ([[prod-schema-drift-destravar]]).
- **Depende de tenders** (POS financeiro) para o "vendas em dinheiro" fiel — sequência importa; se for
  antes, usar `Order.payment` como fallback e marcar TODO.
- **Uma sessão aberta por conta** (v1). Multiterminais é escopo futuro.
- **Conferência cega** é decisão de produto (evita "ajustar pra bater") — não mostrar o esperado antes.
- **Estorno** (Onda B) afeta a conferência se ocorrer dentro do turno — coordenar com aquele plano
  (comanda estornada sai do esperado).
