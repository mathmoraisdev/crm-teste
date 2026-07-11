# Auditoria de Ações — Tier 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Registrar, num log central e imutável, as 8 ações "que dão briga" (quem fez, o quê, quando, e o antes→depois), gravado atomicamente junto com a própria mutação, mais uma tela admin pra consultar.

**Architecture:** Uma tabela `AuditLog` sem foreign keys (imutável, sobrevive a cascade — mesmo padrão de `AccountNotice`/`Order.canceledById`). Um helper central `recordAudit(tx, entry)` que **recebe o cliente de transação** e insere a linha **dentro da mesma transação** da mutação — garantindo "nunca muda sem registrar" e evitando o deadlock de pool de conexão (a lição do agendamento: o helper NUNCA usa o `prisma` global dentro de uma transação, só o `tx` recebido). Os serviços do Tier 1 ganham um parâmetro `actorId` (o `sessionUserId` da rota), que hoje é descartado na borda. Para as ações de edição, o `select` de checagem de posse que os serviços já fazem é ampliado pra capturar o "antes" barato e gerar um diff raso só dos campos mudados.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres (Supabase, pooler de transação) · Vitest (testes de integração contra o Postgres local do Docker) · TypeScript.

---

## Decisões de design (leia antes de começar)

1. **Hook na camada de service, in-transaction.** Não na borda da rota. Motivo: o service já carrega o estado "antes" (checagem de posse) e monta o "depois" (o patch), e roda dentro de `$transaction` — é o único lugar onde dá pra ter atomicidade + diff rico. A rota só passa `ctx.sessionUserId` adiante.

2. **`recordAudit(tx, …)` recebe o `tx` e SÓ usa o `tx`.** Nunca o `prisma` global. Chamar o cliente global dentro de uma transação aberta é exatamente o que travou o agendamento com "connection pool timeout". Toda mutação auditada precisa estar dentro de um `prisma.$transaction(async (tx) => { … await recordAudit(tx, …) })`.

3. **`action` e `entityType` são `String`, não enum Prisma.** Assim adicionar ações no Tier 2 não exige migration. A segurança de tipo vem de uma union TS `AuditAction` no código.

4. **Sem foreign keys** em `accountId`/`actorId`. O log é imutável e precisa sobreviver ao delete de operador (que reatribui FKs ao dono, ver `team.service.ts:137`) e ao cascade de conta. Guardamos `actorName` como **snapshot** (nome/email no momento) pra nunca perder "quem era" — mesmo padrão deliberado do `AccountNotice` (`schema.prisma:379-390`).

5. **Só registra se algo mudou de fato.** Nas ações de diff, se o patch não alterou nenhum campo auditado, não grava linha (evita ruído de "salvar sem mudar").

6. **BYOK fica fora do Tier 1.** Nenhuma das 8 ações loga segredo. (Trocar chave de pagamento/fiscal/IA é Tier 2 e, quando entrar, loga só "trocou a chave", nunca o valor.)

**As 8 ações do Tier 1 e seus códigos `AuditAction`:**

| Ação | Service (arquivo:linha) | AuditAction | Tipo | Autor hoje |
|---|---|---|---|---|
| Estorno de comanda | `voidOrder` — order.service.ts:440 | `ORDER_VOID` | evento | já tem (`byId`) |
| Excluir despesa | `deleteExpense` — expense.service.ts:149 | `EXPENSE_DELETE` | evento | não |
| Excluir cliente/lead | `deleteLead` — lead.service.ts:411 | `LEAD_DELETE` | evento | não |
| Reatribuir lead | `assignConversation` — inbox.service.ts:185 | `LEAD_REASSIGN` | evento | não |
| Editar dados do cliente | `updateLead` — lead.service.ts:326 | `LEAD_UPDATE` | diff | não |
| Editar permissões de operador | `updateOperatorPerms` — team.service.ts:115 | `OPERATOR_PERMS_UPDATE` | diff | não |
| Desconto na comanda | `setOrderAdjustments` — order.service.ts:209 | `ORDER_DISCOUNT` | diff | não |
| Alterar preço do catálogo | `updateCatalogItem` — catalog.service.ts:130 | `CATALOG_PRICE_UPDATE` | diff | não |

**Convenções de teste (confirmadas no repo):**
- Testes são de integração contra o Postgres local (Docker `crm-postgres`). Garanta que ele está de pé antes de rodar.
- Padrão de setup: `import { prisma } from "@/server/db/client"` + um helper `makeOwner()` que faz `prisma.user.create({ data: { email: unique, name, passwordHash: "x" } })`. Copie de `src/server/services/expense.service.test.ts:8-13`.
- Rodar um arquivo: `npx vitest run <caminho>`. Rodar tudo: `npx vitest run`.
- Antes de qualquer `prisma db push`/`generate`: **pare o `next dev`** (senão dá EPERM no rename da DLL do query-engine — ver memória do projeto).

---

## Phase 1 — Fundação (modelo + helpers)

### Task 1.1: Modelo `AuditLog` no schema

**Files:**
- Modify: `prisma/schema.prisma` (adicionar model no fim)

**Step 1: Adicionar o model**

Adicione ao final de `prisma/schema.prisma`:

```prisma
/// Log de auditoria central e imutável (Tier 1). Sem FKs de propósito:
/// sobrevive a delete de operador (FKs reatribuídas ao dono) e a cascade de conta.
/// `action`/`entityType` são String (não enum) p/ não exigir migration a cada ação nova.
model AuditLog {
  id         String   @id @default(cuid())
  accountId  String   // dono/tenant (= tenantUserId), escopo de leitura
  actorId    String   // sessionUserId de quem executou a ação
  actorName  String   // snapshot do nome/email do autor (sobrevive ao delete)
  action     String   // ver union AuditAction em src/server/audit/record.ts
  entityType String   // "Order" | "Lead" | "Expense" | "CatalogItem" | "User"
  entityId   String
  summary    String   // texto pt-BR pronto p/ exibir
  diff       Json?    // só os campos mudados: { campo: { from, to } }
  createdAt  DateTime @default(now())

  @@index([accountId, createdAt])
  @@index([accountId, entityType, entityId])
}
```

**Step 2: Parar o next dev e aplicar no banco local**

Run (com o `next dev` PARADO):
```
npx prisma db push
npx prisma generate
```
Expected: `db push` cria a tabela `AuditLog`; `generate` regenera o client sem erro. Se der EPERM, o dev server ainda está rodando — pare e repita.

**Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(auditoria): modelo AuditLog (Tier 1, sem FK, imutável)"
```

---

### Task 1.2: Util `computeDiff`

**Files:**
- Create: `src/server/audit/diff.ts`
- Test: `src/server/audit/diff.test.ts`

**Step 1: Escrever o teste que falha**

```ts
// src/server/audit/diff.test.ts
import { describe, it, expect } from "vitest";
import { computeDiff } from "./diff";

describe("computeDiff", () => {
  it("retorna só os campos que mudaram", () => {
    const before = { name: "Ana", phone: "11", email: "a@a" };
    const after = { name: "Ana Paula", phone: "11" };
    expect(computeDiff(before, after, ["name", "phone", "email"])).toEqual({
      name: { from: "Ana", to: "Ana Paula" },
    });
  });

  it("ignora campos ausentes no patch (undefined != mudança)", () => {
    const before = { priceCents: 2000, active: true };
    const after = { priceCents: 2400 };
    expect(computeDiff(before, after, ["priceCents", "active"])).toEqual({
      priceCents: { from: 2000, to: 2400 },
    });
  });

  it("objeto vazio quando nada mudou", () => {
    const before = { name: "Ana" };
    expect(computeDiff(before, { name: "Ana" }, ["name"])).toEqual({});
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/audit/diff.test.ts`
Expected: FAIL ("Cannot find module './diff'").

**Step 3: Implementar**

```ts
// src/server/audit/diff.ts
export type FieldChange = { from: unknown; to: unknown };
export type Diff = Record<string, FieldChange>;

/**
 * Diff raso: só os campos de `fields` que EXISTEM no patch (`after`) e diferem do `before`.
 * Campo ausente no patch = não mudou (undefined não conta). Comparação com !== (valores primitivos).
 */
export function computeDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Diff {
  const diff: Diff = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(after, f) && after[f] !== before[f]) {
      diff[f as string] = { from: before[f], to: after[f] };
    }
  }
  return diff;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/audit/diff.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add src/server/audit/diff.ts src/server/audit/diff.test.ts
git commit -m "feat(auditoria): util computeDiff (diff raso por campo)"
```

---

### Task 1.3: Helper `recordAudit`

**Files:**
- Create: `src/server/audit/record.ts`
- Test: `src/server/audit/record.test.ts`

**Step 1: Escrever o teste que falha**

```ts
// src/server/audit/record.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { recordAudit } from "./record";

async function makeUser(name: string) {
  const u = await prisma.user.create({
    data: { email: `aud_${Math.round(performance.now())}_${Math.random()}@t.test`, name, passwordHash: "x" },
  });
  return u.id;
}

describe("recordAudit", () => {
  it("grava a linha com snapshot do nome do autor, dentro da tx", async () => {
    const owner = await makeUser("Dono");
    const actor = await makeUser("Operador Zé");
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        accountId: owner,
        actorId: actor,
        action: "LEAD_DELETE",
        entityType: "Lead",
        entityId: "lead-123",
        summary: "Excluiu o cliente Fulano",
      });
    });
    const row = await prisma.auditLog.findFirst({ where: { accountId: owner } });
    expect(row?.actorName).toBe("Operador Zé");
    expect(row?.action).toBe("LEAD_DELETE");
    expect(row?.entityId).toBe("lead-123");
    expect(row?.diff).toBeNull();
  });

  it("usa email como fallback de nome e persiste o diff", async () => {
    const owner = await makeUser("Dono2");
    const actor = await prisma.user.create({
      data: { email: `noname_${Math.random()}@t.test`, name: null, passwordHash: "x" },
    });
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        accountId: owner, actorId: actor.id, action: "CATALOG_PRICE_UPDATE",
        entityType: "CatalogItem", entityId: "it-1", summary: "Mudou preço",
        diff: { priceCents: { from: 2000, to: 2400 } },
      });
    });
    const row = await prisma.auditLog.findFirst({ where: { accountId: owner } });
    expect(row?.actorName).toBe(actor.email);
    expect(row?.diff).toEqual({ priceCents: { from: 2000, to: 2400 } });
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/audit/record.test.ts`
Expected: FAIL ("Cannot find module './record'").

**Step 3: Implementar**

```ts
// src/server/audit/record.ts
import type { Prisma } from "@prisma/client";
import type { Diff } from "./diff";

/** Todas as ações auditadas. String no banco; union aqui pra segurança de tipo. */
export type AuditAction =
  | "ORDER_VOID"
  | "EXPENSE_DELETE"
  | "LEAD_DELETE"
  | "LEAD_REASSIGN"
  | "LEAD_UPDATE"
  | "OPERATOR_PERMS_UPDATE"
  | "ORDER_DISCOUNT"
  | "CATALOG_PRICE_UPDATE";

export type AuditInput = {
  accountId: string;   // dono/tenant (tenantUserId)
  actorId: string;     // sessionUserId de quem agiu
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  diff?: Diff;
};

/**
 * Insere uma linha de auditoria DENTRO da transação recebida (`tx`).
 * IMPORTANTE: usa SÓ o `tx` — nunca o `prisma` global. Chamar o cliente global
 * dentro de uma tx aberta trava o pool de conexão (lição do agendamento).
 * Busca o nome do autor no momento (1 lookup por PK) e grava como snapshot.
 */
export async function recordAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: input.actorId },
    select: { name: true, email: true },
  });
  await tx.auditLog.create({
    data: {
      accountId: input.accountId,
      actorId: input.actorId,
      actorName: actor?.name ?? actor?.email ?? input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      diff: input.diff as Prisma.InputJsonValue | undefined,
    },
  });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/audit/record.test.ts`
Expected: PASS (2 testes).

**Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → Expected: sem erros.
```bash
git add src/server/audit/record.ts src/server/audit/record.test.ts
git commit -m "feat(auditoria): helper recordAudit (in-tx, snapshot de autor)"
```

---

## Phase 2 — Fatia de referência: Estorno (`voidOrder`)

`voidOrder` já tem o autor (`byId`) e já roda dentro de `prisma.$transaction` (order.service.ts:446). É a fatia mais barata pra provar o padrão ponta-a-ponta. Nenhuma mudança de assinatura ou de rota aqui.

### Task 2.1: Auditar `ORDER_VOID`

**Files:**
- Modify: `src/server/services/order.service.ts` (dentro do `$transaction` de `voidOrder`, ~linha 454)
- Test: `src/server/services/order.audit.test.ts` (novo)

**Step 1: Escrever o teste que falha**

Crie `src/server/services/order.audit.test.ts`. Leia primeiro `src/server/services/cash-session.service.test.ts` ou os testes de order existentes pra copiar como se cria uma comanda FECHADA no harness (usuário dono, catálogo, `openOrder`/`addItem`/`closeOrder`). O núcleo do teste:

```ts
// esqueleto — adapte o arrange ao harness real de order
it("estorno grava AuditLog ORDER_VOID com autor e motivo", async () => {
  const owner = await makeOwner();
  const actor = owner; // no estorno o ADMIN é o autor; use um operador se o harness permitir
  const order = await makeClosedOrder(owner); // helper que abre+fecha uma comanda
  await voidOrder(owner, order.id, "cliente desistiu", actor);

  const log = await prisma.auditLog.findFirst({
    where: { accountId: owner, action: "ORDER_VOID", entityId: order.id },
  });
  expect(log).toBeTruthy();
  expect(log?.summary).toContain("cliente desistiu");
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/order.audit.test.ts`
Expected: FAIL (log é `null`).

**Step 3: Implementar**

Em `voidOrder`, dentro do `await prisma.$transaction(async (tx) => { … })` (order.service.ts:446-455), **depois** do `reverseOrderStockExit(tx, …)`, adicione:

```ts
    await recordAudit(tx, {
      accountId,
      actorId: byId,
      action: "ORDER_VOID",
      entityType: "Order",
      entityId: orderId,
      summary: `Estornou a comanda #${order.number ?? orderId} — motivo: ${trimmed}`,
    });
```

Adicione o import no topo do arquivo:
```ts
import { recordAudit } from "@/server/audit/record";
```
> Ajuste `order.number` ao campo real de exibição da comanda (confira o que `loadOwned`/`OrderDTO` expõe; se não houver número, use só `orderId`).

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/order.audit.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/order.service.ts src/server/services/order.audit.test.ts
git commit -m "feat(auditoria): registra ORDER_VOID no estorno de comanda"
```

---

## Phase 3 — Ações de evento (deletes + reatribuição)

Estas mutações hoje são um único `.delete`/`.update` fora de transação e **não recebem o autor**. Padrão pra cada uma: (a) ampliar a assinatura com `actorId: string`; (b) envolver leitura-de-posse + mutação + `recordAudit` num `prisma.$transaction`; (c) a rota passa `ctx.sessionUserId`.

### Task 3.1: `EXPENSE_DELETE`

**Files:**
- Modify: `src/server/services/expense.service.ts` (`deleteExpense`, ~149)
- Modify: `src/app/api/vendas/expenses/[id]/route.ts` (DELETE, ~32)
- Test: `src/server/services/expense.service.test.ts` (adicionar caso)

**Step 1: Teste que falha**

Adicione a `expense.service.test.ts`:
```ts
it("deleteExpense grava AuditLog EXPENSE_DELETE", async () => {
  const a = await makeOwner();
  const e = await createExpense(a, { description: "Aluguel", amountCents: 150000, dueDate: "2026-07-05", createdById: a });
  await deleteExpense(a, e.id, a); // novo 3º arg: actorId
  const log = await prisma.auditLog.findFirst({ where: { accountId: a, action: "EXPENSE_DELETE" } });
  expect(log?.entityId).toBe(e.id);
  expect(log?.summary).toContain("Aluguel");
});
```

**Step 2: Rodar e ver falhar** — `npx vitest run src/server/services/expense.service.test.ts` → FAIL (assinatura antiga / log null).

**Step 3: Implementar**

Em `deleteExpense`, mude a assinatura pra `deleteExpense(accountId: string, id: string, actorId: string)` e reescreva o corpo pra transação:
```ts
export async function deleteExpense(accountId: string, id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.expense.findFirst({
      where: { id, accountId },
      select: { id: true, description: true, amountCents: true },
    });
    if (!before) throw new Error("Despesa não encontrada.");
    await tx.expense.delete({ where: { id } });
    await recordAudit(tx, {
      accountId, actorId, action: "EXPENSE_DELETE", entityType: "Expense", entityId: id,
      summary: `Excluiu a despesa "${before.description}" (${formatCentsBRL(before.amountCents)})`,
    });
  });
}
```
Imports no topo: `import { recordAudit } from "@/server/audit/record";` e `import { formatCentsBRL } from "@/lib/money";`.
> Ajuste o `where`/erro ao que o código atual faz (ele já valida posse — reuse o mesmo `where`). Confirme o nome do campo de valor (`amountCents`).

Na rota DELETE (`.../expenses/[id]/route.ts`), passe o autor: `await deleteExpense(ctx.tenantUserId, id, ctx.sessionUserId)`.
> Confirme como a rota obtém `ctx` (`getTenantContext()`) e o nome do arg de conta que ela já passa; troque só pra incluir `ctx.sessionUserId`.

**Step 4: Rodar e ver passar** — `npx vitest run src/server/services/expense.service.test.ts` → PASS. Depois `npx tsc --noEmit` (pega qualquer caller antigo de `deleteExpense`).

**Step 5: Commit**
```bash
git add src/server/services/expense.service.ts src/app/api/vendas/expenses/[id]/route.ts src/server/services/expense.service.test.ts
git commit -m "feat(auditoria): registra EXPENSE_DELETE na exclusão de despesa"
```

### Task 3.2: `LEAD_DELETE`

**Files:**
- Modify: `src/server/services/lead.service.ts` (`deleteLead`, ~411)
- Modify: `src/app/api/leads/[id]/route.ts` (DELETE, ~65)
- Test: `src/server/services/lead.service.test.ts` (adicionar caso)

Mesma receita da 3.1. Assinatura vira `deleteLead(userId: string, id: string, actorId: string)`. Snapshot antes do delete: `select: { id: true, name: true, phone: true }`. Summary: `Excluiu o cliente "${before.name ?? before.phone ?? id}"`. `entityType: "Lead"`. A rota passa `ctx.sessionUserId`.
> Atenção: `deleteLead` faz cascade — mantenha o delete como está, só o envolva na tx com o snapshot + `recordAudit`. Confirme o nome do arg de conta (`userId`).

Teste (adaptar ao harness de lead.service.test.ts):
```ts
it("deleteLead grava AuditLog LEAD_DELETE com snapshot do nome", async () => {
  const a = await makeOwner();
  const lead = await createLead(a, { name: "Fulano", phone: "5511999999999" }); // use o criador real do harness
  await deleteLead(a, lead.id, a);
  const log = await prisma.auditLog.findFirst({ where: { accountId: a, action: "LEAD_DELETE" } });
  expect(log?.entityId).toBe(lead.id);
  expect(log?.summary).toContain("Fulano");
});
```
Steps: teste falha → implementa → passa → `npx tsc --noEmit` → commit `feat(auditoria): registra LEAD_DELETE na exclusão de cliente`.

### Task 3.3: `LEAD_REASSIGN`

**Files:**
- Modify: `src/server/services/inbox.service.ts` (`assignConversation`, ~185)
- Modify: `src/app/api/inbox/[id]/assign/route.ts`
- Test: `src/server/services/inbox.service.test.ts` (adicionar caso)

`assignConversation` grava o **destino** (`operatorId`); precisamos do **autor** também. Assinatura ganha `actorId`. Capture o `assignedToId` anterior pra o diff/summary:
```ts
// dentro de um prisma.$transaction(async (tx) => { ... })
const before = await tx.lead.findFirst({ where: { id, userId: accountId }, select: { assignedToId: true, name: true } });
if (!before) throw new Error("Conversa não encontrada.");
const updated = await tx.lead.update({ where: { id }, data: { assignedToId: operatorId } });
if (before.assignedToId !== operatorId) {
  await recordAudit(tx, {
    accountId, actorId, action: "LEAD_REASSIGN", entityType: "Lead", entityId: id,
    summary: `Reatribuiu o cliente "${before.name ?? id}"`,
    diff: { assignedToId: { from: before.assignedToId, to: operatorId } },
  });
}
```
> Adapte aos nomes reais (`accountId`/`userId`, `operatorId`). A rota `.../assign/route.ts` já resolve o destino; some `ctx.sessionUserId` como `actorId`.

Teste: cria lead atribuído ao operador X, reatribui ao Y como autor Z, espera `LEAD_REASSIGN` com `diff.assignedToId.from === X` e `.to === Y`. Steps padrão → commit `feat(auditoria): registra LEAD_REASSIGN na reatribuição de cliente`.

---

## Phase 4 — Diffs de dinheiro

### Task 4.1: `ORDER_DISCOUNT`

**Files:**
- Modify: `src/server/services/order.service.ts` (`setOrderAdjustments`, ~209)
- Modify: `src/app/api/vendas/orders/[id]/route.ts` (PATCH, ~59)
- Test: `src/server/services/order.audit.test.ts` (adicionar caso)

`setOrderAdjustments` é um `.update` (order.service.ts:243). Envolva em tx, capture os valores de ajuste antigos, aplique, gere diff. Assinatura ganha `actorId`. Campos auditados: os de desconto/acréscimo que a função aceita (ex.: `discountCents`, `surchargeCents` — confirme os nomes reais lendo a função).
```ts
export async function setOrderAdjustments(accountId: string, orderId: string, input: {...}, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findFirst({
      where: { id: orderId, accountId },
      select: { id: true, number: true, discountCents: true, surchargeCents: true },
    });
    if (!before) throw new Error("Comanda não encontrada.");
    const updated = await tx.order.update({ where: { id: orderId }, data: patch });
    const diff = computeDiff(before, patch, ["discountCents", "surchargeCents"]);
    if (Object.keys(diff).length) {
      await recordAudit(tx, {
        accountId, actorId, action: "ORDER_DISCOUNT", entityType: "Order", entityId: orderId,
        summary: `Ajustou a comanda #${before.number ?? orderId}` +
          (diff.discountCents ? ` — desconto ${formatCentsBRL(Number(diff.discountCents.from) || 0)} → ${formatCentsBRL(Number(diff.discountCents.to) || 0)}` : ""),
        diff,
      });
    }
    return toDTO(updated); // mantenha o retorno que a função já dá
  });
}
```
> Ajuste `patch`, campos e retorno ao código real. Imports `computeDiff`/`formatCentsBRL` se ainda não houver. A rota PATCH passa `ctx.sessionUserId`.

Teste: cria comanda, aplica desconto, espera `ORDER_DISCOUNT` com `diff.discountCents`. Steps padrão → commit `feat(auditoria): registra ORDER_DISCOUNT em ajuste de comanda`.

### Task 4.2: `CATALOG_PRICE_UPDATE`

**Files:**
- Modify: `src/server/services/catalog.service.ts` (`updateCatalogItem`, ~130)
- Modify: `src/app/api/vendas/catalog/[id]/route.ts`
- Test: `src/server/services/catalog.service.test.ts` (adicionar caso) — ou o arquivo de teste de catálogo existente

`updateCatalogItem` já faz um `findFirst`/`loadOwned` de posse (~catalog.service.ts:140) — amplie o `select` pra incluir `priceCents` e `name`. Só auditamos `priceCents` no Tier 1 (o resto do patch continua salvando normal, só não gera log).
```ts
// dentro de prisma.$transaction(async (tx) => { ... }); assinatura ganha actorId
const before = await tx.catalogItem.findFirst({ where: { id, accountId }, select: { id: true, name: true, priceCents: true } });
if (!before) throw new Error("Item não encontrado.");
const updated = await tx.catalogItem.update({ where: { id }, data: patch });
const diff = computeDiff(before, patch, ["priceCents"]);
if (diff.priceCents) {
  await recordAudit(tx, {
    accountId, actorId, action: "CATALOG_PRICE_UPDATE", entityType: "CatalogItem", entityId: id,
    summary: `Alterou o preço de "${before.name}": ${formatCentsBRL(Number(diff.priceCents.from))} → ${formatCentsBRL(Number(diff.priceCents.to))}`,
    diff,
  });
}
return toDTO(updated);
```
> `updateCatalogItem` hoje não é transacional — envolva leitura+update no `$transaction`. A rota passa `ctx.sessionUserId`.

Teste: cria item a 2000, atualiza pra 2400, espera `CATALOG_PRICE_UPDATE` com summary contendo "R$ 20,00 → R$ 24,00". Steps padrão → commit `feat(auditoria): registra CATALOG_PRICE_UPDATE em mudança de preço`.

---

## Phase 5 — Diffs de pessoas/acesso

### Task 5.1: `LEAD_UPDATE`

**Files:**
- Modify: `src/server/services/lead.service.ts` (`updateLead`, ~326)
- Modify: `src/app/api/leads/[id]/route.ts` (PATCH, ~39)
- Test: `src/server/services/lead.service.test.ts` (adicionar caso)

`updateLead` já monta um `patch` incremental e faz checagem de posse (~lead.service.ts:340). Amplie o `select` de posse pra `{ name, phone, email }`, envolva em tx, diff só desses campos de contato. **Não** audite `status` aqui (mudança de funil é Tier 2). Assinatura ganha `actorId`.
```ts
// dentro de prisma.$transaction
const before = await tx.lead.findFirst({ where: { id, userId: accountId }, select: { id: true, name: true, phone: true, email: true } });
if (!before) throw new Error("Cliente não encontrado.");
const updated = await tx.lead.update({ where: { id }, data: patch });
const diff = computeDiff(before, patch, ["name", "phone", "email"]);
if (Object.keys(diff).length) {
  await recordAudit(tx, {
    accountId, actorId, action: "LEAD_UPDATE", entityType: "Lead", entityId: id,
    summary: `Editou dados do cliente "${before.name ?? before.phone ?? id}"`,
    diff,
  });
}
return updated;
```
> Mantenha a montagem do `patch` atual (só mova pra dentro da tx). Confirme o nome do arg de conta (`userId`) e que o retorno bate. A rota PATCH passa `ctx.sessionUserId`.

Teste: cria lead, muda `name`, espera `LEAD_UPDATE` com `diff.name.from`/`.to`. Confirme que salvar SEM mudar campo de contato (ex.: só `notes`) **não** gera log. Steps padrão → commit `feat(auditoria): registra LEAD_UPDATE em edição de dados do cliente`.

### Task 5.2: `OPERATOR_PERMS_UPDATE`

**Files:**
- Modify: `src/server/services/team.service.ts` (`updateOperatorPerms`, ~115)
- Modify: `src/app/api/team/[id]/route.ts` (~19)
- Test: `src/server/services/team.service.test.ts` (adicionar caso)

A mais sensível: registra quem mexeu nas permissões de quem. Amplie o `select` pra os 5 campos, envolva em tx, diff. Assinatura ganha `actorId`.
```ts
// dentro de prisma.$transaction
const before = await tx.user.findFirst({
  where: { id: operatorId, ownerId: adminUserId },
  select: { id: true, name: true, role: true, canFinance: true, canSettings: true, canCampaigns: true, leadsScope: true },
});
if (!before) throw new Error("Operador não encontrado.");
const updated = await tx.user.update({ where: { id: operatorId }, data: patch });
const diff = computeDiff(before, patch, ["role", "canFinance", "canSettings", "canCampaigns", "leadsScope"]);
if (Object.keys(diff).length) {
  await recordAudit(tx, {
    accountId: adminUserId, actorId, action: "OPERATOR_PERMS_UPDATE", entityType: "User", entityId: operatorId,
    summary: `Alterou permissões de "${before.name ?? operatorId}"`,
    diff,
  });
}
return updated;
```
> Confirme o nome do arg (`adminUserId`) e o `where` de posse que a função já usa (dono só edita membro seu). A rota (só ADMIN) passa `ctx.sessionUserId` como `actorId`.

Teste: dono cria operador com `canFinance:true`, chama `updateOperatorPerms` mudando pra `false`, espera `OPERATOR_PERMS_UPDATE` com `diff.canFinance.from===true`, `.to===false`. Steps padrão → commit `feat(auditoria): registra OPERATOR_PERMS_UPDATE em mudança de permissões`.

**Checkpoint pós-Phase 5:** rode a suíte inteira: `npx vitest run` (todas as 8 ações auditadas + nada quebrado) e `npx tsc --noEmit`.

---

## Phase 6 — Leitura (tela admin)

### Task 6.1: Serviço de leitura `listAudit`

**Files:**
- Create: `src/server/services/audit.service.ts`
- Test: `src/server/services/audit.service.test.ts`

**Step 1: Teste que falha**
```ts
it("listAudit filtra por conta, entityType e pagina por createdAt desc", async () => {
  const owner = await makeOwner();
  const other = await makeOwner();
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, { accountId: owner, actorId: owner, action: "LEAD_DELETE", entityType: "Lead", entityId: "l1", summary: "a" });
    await recordAudit(tx, { accountId: owner, actorId: owner, action: "ORDER_VOID", entityType: "Order", entityId: "o1", summary: "b" });
    await recordAudit(tx, { accountId: other, actorId: other, action: "LEAD_DELETE", entityType: "Lead", entityId: "l2", summary: "c" });
  });
  const all = await listAudit(owner, {});
  expect(all.items).toHaveLength(2); // não vaza a outra conta
  const onlyLeads = await listAudit(owner, { entityType: "Lead" });
  expect(onlyLeads.items.map((i) => i.entityId)).toEqual(["l1"]);
});
```

**Step 2: Rodar → FAIL.**

**Step 3: Implementar**
```ts
// src/server/services/audit.service.ts
import { prisma } from "@/server/db/client";

export type AuditFilters = {
  entityType?: string;
  actorId?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  take?: number;
  cursor?: string; // id do último item da página anterior
};

export async function listAudit(accountId: string, f: AuditFilters) {
  const take = Math.min(f.take ?? 50, 100);
  const items = await prisma.auditLog.findMany({
    where: {
      accountId,
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  return { items: hasMore ? items.slice(0, take) : items, nextCursor: hasMore ? items[take - 1].id : null };
}
```

**Step 4: Rodar → PASS.** **Step 5: Commit** `feat(auditoria): serviço listAudit (escopado + paginado)`.

### Task 6.2: Rota `GET /api/audit` (só ADMIN)

**Files:**
- Create: `src/app/api/audit/route.ts`
- Test: `src/app/api/audit/route.test.ts` (opcional — se houver testes de rota no repo, ex. `numbers/route.test.ts`, espelhe)

**Step 3 (implementação):**
```ts
// src/app/api/audit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listAudit } from "@/server/services/audit.service";

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const parseDate = (v: string | null) => (v ? new Date(v) : undefined);
  const res = await listAudit(ctx.tenantUserId, {
    entityType: sp.get("entityType") ?? undefined,
    actorId: sp.get("actorId") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
    cursor: sp.get("cursor") ?? undefined,
  });
  return NextResponse.json(res);
}
```
> Confirme a assinatura real de `getTenantContext` (é `await getTenantContext()` sem args? passa `req`? veja `tenant.ts:44` e uma rota existente como `api/team/route.ts`). Ajuste. O gate `ctx.role !== "ADMIN"` espelha o de `api/team/route.ts:23-25`.

Commit `feat(auditoria): rota GET /api/audit (admin-only)`.

### Task 6.3: Página `/auditoria` + entrada no menu

**Files:**
- Create: `src/app/(app)/auditoria/page.tsx`
- Modify: o builder de navegação (procure `buildNav`/`moduleVisibleFor` — memória "Reorganização da navegação")

**Step 3:** uma página admin-only que busca `/api/audit`, mostra tabela (Quando · Quem · Ação · Resumo) com filtro por `entityType` e "carregar mais" via `nextCursor`. Espelhe um componente de lista/tabela existente do painel pra herdar estilo (tokens de tema — nunca hex fixo, ver memória "Design tokens"). Adicione a entrada de nav **gated a `role === "ADMIN"`**; se `buildNav` recebe as perms/role, condicione ali (fail-open no grupo "Mais" como o resto).

Verificação manual (não é teste automatizado): rode `npm run dev`, logue como dono, gere uma ação (ex.: exclua uma despesa), abra `/auditoria`, veja a linha. Logue como operador → a rota deve dar 403 e o item de menu não aparecer.

Commit `feat(auditoria): tela /auditoria admin-only + entrada de menu`.

---

## Phase 7 — Retenção + deploy

### Task 7.1: Poda por retenção no worker

**Files:**
- Modify: o loop periódico do worker (procure onde rodam os jobs de lifecycle/reaper, ex. `src/server/worker/`)
- Modify: `src/lib/env.ts` (nova env `AUDIT_RETENTION_DAYS`, default 180)

**Step 3:** adicione uma função de poda e chame-a no tick periódico existente:
```ts
// onde ficam os jobs periódicos do worker
export async function pruneAuditLogs(retentionDays: number) {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
```
Em `env.ts`, adicione `AUDIT_RETENTION_DAYS` (número, default 180) seguindo o padrão das outras envs numéricas. Chame `pruneAuditLogs(env.AUDIT_RETENTION_DAYS)` uma vez por dia no worker (reuse o agendador dos jobs existentes; não crie timer novo se já houver um "daily").

Teste unitário: insere 1 log com `createdAt` antigo (via `prisma.auditLog.create` com data no passado) e 1 recente, chama `pruneAuditLogs(180)`, espera que só o antigo suma.

Commit `feat(auditoria): poda por retenção (AUDIT_RETENTION_DAYS, default 180)`.

### Task 7.2: Deploy / migração em produção

**Não** rode SQL manual redundante se o build já roda `migrate deploy` (memória "PROD schema drift"). Como é uma tabela **nova e isolada**, o caminho seguro:

- **Dev:** já aplicado via `prisma db push` na Task 1.1.
- **Prod:** deixe o build ser dono. Se o fluxo for `migrate deploy`, gere a migration (`npx prisma migrate dev --name auditoria_tier1` num ambiente de migration) e garanta que o SQL seja idempotente. SQL de referência (idempotente) caso precise aplicar por `prisma db execute`:

```sql
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "diff" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId","createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_accountId_entityType_entityId_idx" ON "AuditLog"("accountId","entityType","entityId");
```

- **Worker:** a poda (Task 7.1) roda no worker (Oracle) — após o deploy do web, atualizar o worker (`git pull` + restart do serviço, ver memória "Atualizar worker no Oracle"). Sem a env `AUDIT_RETENTION_DAYS` ele usa o default 180.
- **Custo:** só storage (Supabase Pro, dentro da franquia), zero egress relevante, **zero Upstash** (a auditoria não toca Redis). Sem streaming de eventos de auditoria.

Commit final / tag conforme convenção do repo.

---

## Estratégia de testes (resumo)

- **Unitário puro:** `computeDiff` (Task 1.2).
- **Integração contra Postgres local:** `recordAudit` + cada uma das 8 ações (asserta que a linha `AuditLog` nasce com autor, ação, entityId e summary corretos) + `listAudit` (escopo por conta + filtro) + poda.
- **Regressão de "não muda sem registrar":** nos casos de diff, um teste que salva SEM alterar campo auditado e verifica que **nenhuma** linha é criada.
- **Manual/E2E leve:** a tela `/auditoria` (Phase 6.3) — dono vê, operador leva 403.
- Rodar a suíte inteira ao fim de cada fase: `npx vitest run` + `npx tsc --noEmit`.

## Fora de escopo (Tier 2, não fazer agora)

Mudança de status no funil, criar/remover operador, reabrir comanda, ativar/desativar item, ajuste manual de estoque (já é ledger com autor), regras de comissão, config da IA, troca de chave BYOK (loga só "trocou a chave", nunca o valor), horário de funcionamento, delivery/zonas. E o **agente de IA que lê a auditoria** — só depois que o log estiver povoado.
