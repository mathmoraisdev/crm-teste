# Permissões de operador: separar "Financeiro & fiscal" de "Config & IA" — Plano

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Quebrar o gate único `canSettings` (que hoje esconde ~15 capacidades, várias de dinheiro/irreversível) em **duas** permissões explícitas por operador — `canSettings` (Configurar atendimento & IA, risco baixo/médio) e a nova `canFinance` (Financeiro & fiscal, risco alto) — mantendo `canCampaigns` e `leadsScope` como estão.

**Architecture:** Adiciona uma coluna booleana `canFinance` em `User` (default `true`, backfill = valor atual de `canSettings` p/ preservar comportamento). O `OperatorPerms` ganha o campo; o dono/ADMIN continua com acesso total a tudo. Os ~10 pontos de enforcement "de dinheiro" trocam a checagem de `ctx.perms.canSettings` → `ctx.perms.canFinance`. A UI da aba Equipe ganha um 3º checkbox e **hints que listam o que cada permissão concede** (resolve o problema de "o admin não sabe o que libera").

**Tech Stack:** Next.js (App Router) + Prisma 6 + Postgres + Zod + Vitest. Migration Prisma idempotente aplicada pelo build (`prisma migrate deploy`) — ver [[prod-schema-drift-destravar]]: mudança COM pasta de migration → o build é dono, SQL idempotente, **sem** `onda-*.sql` manual redundante.

---

## Classificação dos gates (o coração do plano)

Cada ponto que hoje checa `ctx.perms.canSettings` cai em um dos dois baldes. Revise antes de executar.

### → `canFinance` (Financeiro & fiscal — risco alto)

| Arquivo | O que gateia |
|---|---|
| `src/app/api/vendas/expenses/route.ts` (GET+POST) | Despesas / contas a pagar (listar/criar) |
| `src/app/api/vendas/expenses/[id]/route.ts` | Editar/excluir despesa |
| `src/app/api/vendas/expenses/[id]/pay/route.ts` | Marcar despesa como paga |
| `src/app/api/vendas/expenses/recurring/route.ts` (GET+POST) | Despesas recorrentes |
| `src/app/api/vendas/expenses/recurring/[id]/route.ts` | Editar/excluir recorrente |
| `src/app/api/vendas/orders/[id]/void/route.ts` | **Estorno** de comanda |
| `src/app/api/vendas/orders/[id]/reopen/route.ts` | **Reabertura** de comanda |
| `src/app/api/vendas/orders/[id]/fiscal/route.ts` | Emitir NFC-e |
| `src/app/api/account/fiscal-key/route.ts` (3 gates) | Chave do emissor fiscal |
| `src/app/api/account/payment-key/route.ts` (2 gates) | Chave de pagamento (Pix/cartão) |
| `src/app/api/vendas/reports/route.ts` | Payload de **margem/comissão** nos relatórios |
| `src/app/api/commissions/rules/route.ts` + `[id]/route.ts` | Regras de comissão (quanto o profissional ganha) |
| `src/app/api/vendas/cash-session/[id]/close/route.ts` | Fechar caixa **de outro operador** |
| `src/app/(app)/despesas/page.tsx` | Redirect da página de despesas |
| `src/app/(app)/relatorios/page.tsx` | `canEdit` de saldo/despesas nos relatórios |

### permanece `canSettings` (Configurar atendimento & IA — risco baixo/médio)

`account/ai-key`, `account/pipeline-labels`, `custom-fields` (route + `[id]` + `seed-preset`), `account/business`, `quick-replies` (route + `[id]`), `account/inbox-sla`, `inbox/config` (media library), `booking-settings`, `account/lifecycle`, `onboarding/apply-vertical`, `vendas/catalog` (route + `[id]` + `seed`), `professionals` (route + `[id]` + `working-hours`), `numbers/[id]/offers/seed-preset`, páginas gated (`catalogo`, `inbox`, `agenda`, `caixa`).

### ✅ Decisões resolvidas (2026-07-07)

1. **Estoque** (`vendas/stock` route/entry/adjust/`[id]`/movements) → **`canSettings`** (operacional/cadastro). Permanece na lista "canSettings".
2. **Regras de comissão** → **`canFinance`** (define pagamento a profissional). Está na lista "→ canFinance".
3. **Catálogo** (tem preço) → **`canSettings`** (cadastro). Permanece na lista "canSettings".

Nenhum ajuste na lista de arquivos da Task 5 — os defaults foram confirmados.

---

## Task 1: Schema — coluna `canFinance` + migration idempotente

**Files:**
- Modify: `prisma/schema.prisma:177` (após `canSettings`)
- Create: `prisma/migrations/20260707000000_operator_can_finance/migration.sql`

**Step 1: Editar o schema**

Em `prisma/schema.prisma`, logo abaixo da linha `canSettings`, adicionar:

```prisma
  canFinance         Boolean         @default(true) // pode ver/editar Financeiro & fiscal (despesas, estorno, chaves fiscais/pagamento, comissões)
```

**Step 2: Escrever a migration idempotente**

`prisma/migrations/20260707000000_operator_can_finance/migration.sql`:

```sql
-- Separa "Financeiro & fiscal" do gate de configurações do operador.
-- Idempotente (build é dono via migrate deploy — ver prod-schema-drift-destravar).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canFinance" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: preserva o comportamento atual. Hoje toda ação financeira exigia
-- canSettings=true; espelhar garante que operador que NÃO podia (canSettings=false)
-- continua sem acesso ao financeiro. Só afeta linhas existentes uma vez.
UPDATE "User" SET "canFinance" = "canSettings" WHERE "canFinance" IS DISTINCT FROM "canSettings";
```

> Nota: o `UPDATE` roda em toda aplicação da migration, mas é idempotente na prática
> (após a 1ª vez, novos operadores nascem com o default correto e o WHERE não casa
> linhas já alinhadas por escolha do admin). Como `migrate deploy` aplica cada
> migration **uma vez** e marca em `_prisma_migrations`, não re-executa. OK.

**Step 3: Aplicar local e gerar client**

Pare o `next dev` antes (lock do query-engine no Windows — [[prisma-generate-dev-server-lock]]). Rode:

```bash
npx prisma migrate dev --name operator_can_finance
```

Expected: cria/aplica a migration no Postgres local (Docker — [[local-dev-db-docker]]) e regenera `@prisma/client` com o campo `canFinance`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260707000000_operator_can_finance/
git commit -m "feat(equipe): coluna canFinance (separa financeiro do gate de config)"
```

---

## Task 2: `OperatorPerms` em `tenant.ts` + teste

**Files:**
- Modify: `src/lib/tenant.ts:6-10`, `:23-31`, `:34-37`
- Test: `src/lib/tenant.test.ts`

**Step 1: Atualizar o teste (falha primeiro)**

Em `src/lib/tenant.test.ts`: adicionar `canFinance` aos mocks e às asserções.
- No teste do dono: mock com `canFinance: false` e asserção `perms` com `canFinance: true` (dono ignora flags).
- No teste do operador: mock `canFinance: false`, asserção `perms.canFinance: false`.

**Step 2: Rodar — deve falhar**

```bash
npm test -- src/lib/tenant.test.ts
```
Expected: FAIL (perms não tem `canFinance`).

**Step 3: Implementar**

Em `src/lib/tenant.ts`:
- Interface `OperatorPerms`: add `canFinance: boolean;`
- `select` do `findUnique`: add `canFinance: true,`
- ADMIN: `{ canCampaigns: true, canSettings: true, canFinance: true, leadsScope: "ALL" }`
- OPERADOR: add `canFinance: u.canFinance,`

**Step 4: Rodar — deve passar**

```bash
npm test -- src/lib/tenant.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/tenant.ts src/lib/tenant.test.ts
git commit -m "feat(perms): canFinance no OperatorPerms (dono sempre total)"
```

---

## Task 3: `team.service.ts` — criar/listar/editar com `canFinance`

**Files:**
- Modify: `src/server/services/team.service.ts` (`OperatorPermsInput`, `MemberRow`, `createOperator` data, `listMembers` select, `updateOperatorPerms`)
- Test: `src/server/services/team.service.test.ts`

**Step 1: Teste primeiro** — no `team.service.test.ts`, cobrir que:
- `createOperator` grava `canFinance` (default `true` quando omitido).
- `updateOperatorPerms` faz merge de `canFinance` só quando informado.

**Step 2: Rodar — falha.** `npm test -- src/server/services/team.service.test.ts`

**Step 3: Implementar** em `team.service.ts`:
- `OperatorPermsInput`: add `canFinance?: boolean;`
- `MemberRow`: add `canFinance: boolean;`
- `createOperator` → `data`: add `canFinance: input.canFinance ?? true,`
- `listMembers` → `select`: add `canFinance: true,`
- `updateOperatorPerms` → `data`: add `...(perms.canFinance !== undefined ? { canFinance: perms.canFinance } : {}),`

**Step 4: Rodar — passa.**

**Step 5: Commit**
```bash
git add src/server/services/team.service.ts src/server/services/team.service.test.ts
git commit -m "feat(equipe): team.service grava/edita canFinance"
```

---

## Task 4: Zod das rotas de equipe

**Files:**
- Modify: `src/app/api/team/route.ts:13-15` — add `canFinance: z.boolean().optional(),`
- Modify: `src/app/api/team/[id]/route.ts:11-13` — add `canFinance: z.boolean().optional(),`

**Step 1: Editar ambos os schemas.** **Step 2:** garantir que o POST/PATCH repassam `canFinance` ao service (se o handler desestrutura campos explicitamente, incluir `canFinance`).

**Step 3: Typecheck**
```bash
npx tsc --noEmit
```
Expected: sem erros novos.

**Step 4: Commit**
```bash
git add src/app/api/team/route.ts src/app/api/team/[id]/route.ts
git commit -m "feat(api/team): aceita canFinance no create/patch"
```

---

## Task 5: Reclassificar os gates financeiros (canSettings → canFinance)

Troca mecânica de `ctx.perms.canSettings` → `ctx.perms.canFinance` **apenas** nos arquivos da tabela "→ canFinance". **Não** toque nos que permanecem `canSettings`.

**Files (todos Modify):**
- `src/app/api/vendas/expenses/route.ts` (2 gates)
- `src/app/api/vendas/expenses/[id]/route.ts` (2 gates)
- `src/app/api/vendas/expenses/[id]/pay/route.ts`
- `src/app/api/vendas/expenses/recurring/route.ts` (2 gates)
- `src/app/api/vendas/expenses/recurring/[id]/route.ts` (2 gates)
- `src/app/api/vendas/orders/[id]/void/route.ts`
- `src/app/api/vendas/orders/[id]/reopen/route.ts`
- `src/app/api/vendas/orders/[id]/fiscal/route.ts` (checar o serviço/rota — confirmar onde o gate mora)
- `src/app/api/account/fiscal-key/route.ts` (3 gates)
- `src/app/api/account/payment-key/route.ts` (2 gates)
- `src/app/api/vendas/reports/route.ts` (1 gate — payload margem/comissão)
- `src/app/api/commissions/rules/route.ts` (2 gates) + `src/app/api/commissions/rules/[id]/route.ts` (2 gates)
- `src/app/api/vendas/cash-session/[id]/close/route.ts` (a condição `!ctx.perms.canSettings` → `!ctx.perms.canFinance`)
- `src/app/(app)/despesas/page.tsx` (redirect)
- `src/app/(app)/relatorios/page.tsx` (`canEdit`)

**Step 1: Teste de regressão de gate** — escrever/estender um teste para 2 rotas representativas provando que operador com `canFinance:false` (mas `canSettings:true`) recebe 403:
- Estorno: `src/app/api/vendas/orders/[id]/void/route.ts`
- Despesas: `src/app/api/vendas/expenses/route.ts`

(Se não houver harness de rota pronto, cobrir via um teste de unidade da condição ou marcar como verificação manual no Task 8.)

**Step 2: Aplicar as trocas** arquivo a arquivo. Comentários que digam "→ canSettings" devem virar "→ canFinance".

**Step 3: Garantir que nada financeiro ainda cita canSettings**
```bash
```
Rodar Grep por `canSettings` nos arquivos da lista — esperado: zero ocorrências restantes neles.

**Step 4: Typecheck + testes**
```bash
npx tsc --noEmit && npm test
```

**Step 5: Commit**
```bash
git add -A
git commit -m "feat(perms): gates de financeiro/fiscal passam a exigir canFinance"
```

---

## Task 6: UI da aba Equipe — 3º checkbox + transparência

**Files:**
- Modify: `src/components/app/TeamManager.tsx`

**Step 1:** `interface Member` e o `useState` do form ganham `canFinance` (default `true`). Body do POST inclui `canFinance`. Handler de reset após criar zera p/ `true`.

**Step 2: Adicionar o checkbox** (form de criação e `MemberRow` inline), com **hints que listam o que concede** — este é o fix de transparência que motivou tudo:

- **"Configurar atendimento & IA"** (`canSettings`) — hint: *"Chave de IA, funil, campos, catálogo, respostas rápidas, SLA, profissionais, automações."*
- **"Financeiro & fiscal"** (`canFinance`) — hint: *"Despesas e contas a pagar, estornar/reabrir comanda, chaves de pagamento e fiscal (NFC-e), comissões, relatórios de margem, fechar o caixa de outro operador."*
- **"Disparar campanhas"** (`canCampaigns`) — hint atual mantido.

**Step 3:** `patch()` do `MemberRow` já é genérico (`Partial<Pick<...>>`); estender o `Pick` com `canFinance` e ligar o novo checkbox a `patch({ canFinance: v })`.

**Step 4: Typecheck**
```bash
npx tsc --noEmit
```

**Step 5: Commit**
```bash
git add src/components/app/TeamManager.tsx
git commit -m "feat(equipe/ui): checkbox Financeiro & fiscal + hints do que cada permissão concede"
```

---

## Task 7: Wiring da página + AccountSettings

**Files:**
- Modify: `src/app/(app)/equipe/page.tsx:59-67` — mapear `canFinance: m.canFinance` no `members.map`.
- Inspect+Modify: `src/components/app/AccountSettings.tsx:478/566/624` — verificar se alguma dessas seções gated por `canSettings` é **chave de pagamento** ou **chave fiscal**; se sim, trocar o gate de UI dessas seções para `canFinance` (coerência com o servidor). As seções puramente de config/IA continuam `canSettings`. Passar `canFinance` como prop se necessário.
- Modify: `src/app/(app)/configuracoes/page.tsx` e `campaigns/page.tsx` se lerem `ctx.perms` para essas seções financeiras.

**Step 1:** Ajustar `equipe/page.tsx`. **Step 2:** Ler `AccountSettings.tsx` em volta das linhas 478/566/624, identificar as seções, ajustar gate de UI apenas das financeiras. **Step 3:** `npx tsc --noEmit`. **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(equipe): propaga canFinance na página e na UI de configurações"
```

---

## Task 8: Verificação end-to-end + gate verde

**Step 1: Suite completa + typecheck + lint**
```bash
npx tsc --noEmit && npm test && npm run lint
```
Expected: verde (a baseline atual é ~835 testes — [[reorganizacao-navegacao-feito]]).

**Step 2: Verificação manual (skill `verify`)** — cunhar sessão de operador ([[verify-via-minted-session]]) com `canSettings:true, canFinance:false` e confirmar:
- **Consegue** editar IA/funil/respostas rápidas (200).
- **Bloqueado** (403) em: criar despesa, estornar comanda, salvar chave fiscal, salvar chave de pagamento, ver payload de margem nos relatórios.
- Inverter (`canSettings:false, canFinance:true`) e confirmar o espelho.
- Dono/ADMIN faz tudo.

**Step 3: Commit final** (se houver ajustes da verificação).

---

## Deploy (fora do escopo de código — runbook)

- **Schema:** o build roda `prisma migrate deploy` (package.json:11) → a coluna `canFinance` entra em PROD **automaticamente** no deploy da web e no `start:worker`. **Não** escrever `onda-*.sql` manual (colidiria com a migration → P3018/P3009 — [[prod-schema-drift-destravar]]).
- **Backfill:** o `UPDATE` roda dentro da migration; operadores existentes preservam o comportamento (quem tinha `canSettings=false` nasce com `canFinance=false`).
- **Ordem:** deploy web (Vercel) e restart do worker (Oracle) aplicam a mesma migration; como é aditiva e idempotente, ordem não é crítica, mas rode o build da web primeiro.
- **Rollback:** a coluna é aditiva; reverter código volta a checar `canSettings` sem quebrar (coluna órfã fica inerte). Não precisa dropar coluna.

---

## Riscos e notas

- **Backfill é a rede de segurança:** sem o `UPDATE canFinance = canSettings`, todo operador existente ganharia `canFinance=true` (default) e passaria a poder estornar/ver chave fiscal — **regressão de segurança**. O backfill é obrigatório.
- **UI é cosmética; o servidor é a guarda.** Mesmo que uma seção de UI escape do ajuste, a rota nega com 403. Priorizar acertar os gates de rota (Task 5).
- **Decisões em aberto** (estoque, comissões, catálogo) mudam quais arquivos entram na Task 5 — resolver ANTES de executar.
- **Sem tocar em `canCampaigns`/`leadsScope`.** Escopo cirúrgico.
