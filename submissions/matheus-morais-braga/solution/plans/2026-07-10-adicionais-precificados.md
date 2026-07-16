# Adicionais Precificados (modifiers) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que um item do catálogo tenha grupos de adicionais/variações com preço (ex.: "Tamanho: Grande +R$8", "Adicionais: Bacon +R$5"), escolhidos ao adicionar o item — no PDV, no cardápio público e pela IA — somando ao preço e imprimindo no cupom e na comanda de cozinha.

**Architecture:** Dois modelos novos por item — `ModifierGroup` (nome + min/max de escolha) → `ModifierOption` (nome + `priceDeltaCents`). A escolha do cliente NÃO cria linhas novas de total: o delta é **somado ao `unitPriceCents` do `OrderItem`** (base + Σ deltas) e a seleção vira um **snapshot** em `OrderItem.modifiersSnapshot` (Json). Assim total derivado, comissão, estoque, fechamento e Pix continuam funcionando sem tocar na matemática — só o preço unitário já chega somado. O servidor SEMPRE resolve o delta a partir do banco (nunca confia no client). Um resolver único (`modifier.service.ts`) é a fonte de verdade, consumido por `addItem` (PDV/IA) e por `placeOnlineOrder` (cardápio).

**Tech Stack:** Next.js (App Router), Prisma/Postgres (Supabase), Vitest, React/Tailwind. Schema entra por SQL manual idempotente (`onda-N`), no precedente da onda-L — schema.prisma + `prisma/manual/2026-07-10-onda-N-adicionais.sql`, SEM migration versionada.

**Decisões travadas (YAGNI):**
- Grupos são **por item** (não reutilizáveis entre itens). Reutilização fica para depois.
- `minSelect`/`maxSelect` codificam os 4 casos: obrigatório-único (1/1, ex. tamanho), opcional-único (0/1), multi-opcional (0/N), multi-obrigatório (1/N).
- Delta somado no `unitPriceCents`; sem coluna de preço nova no `OrderItem`.
- Fases 1–4 entregam o PDV ponta-a-ponta; 5 o cardápio público; 6 recibo/cozinha; 7 IA. Dá para parar/deployar após qualquer fase (a feature é opt-in por item — item sem grupos se comporta exatamente como hoje).

---

## Revisão final (CONGELADO — verificado contra o código em 2026-07-10)

Conferido arquivo por arquivo antes de congelar. Achados incorporados:
- **`onda-N` não colide** — `prisma/manual/` tem até `2026-07-10-onda-M.sql`; `N` está livre.
- **Recibo tem DOIS renderizadores** (`ReceiptDocument.tsx` React/N1 + `escpos.ts` bytes/N2), ambos consomem o `ReceiptModel`. Task 7 reescrita para tocar os dois via `ReceiptLine.subLines`.
- **`buildReceiptModel` recalcula o total** a partir de `lines[].totalCents` (model.ts:120/124) → sub-linha de adicional NÃO pode somar; teste com assert de "total imutável".
- **`KNOWN_CODES` do checkout não tinha `MODIFIER`** (pedido/route.ts:43) → adicionado à Task 10, senão o erro vira 400 genérico.
- **`hasModifiers` via `_count`** no `CatalogItemDTO`/`listCatalogItems` (evita N+1 por clique no PDV).
- **`ModifierPicker` nasce em `src/components/menu/`** (compartilhado PDV+cardápio) — não em `components/vendas/`.
- Confirmados: `addItem`/`items/route.ts` (`addSchema` repassa `parsed.data` inteiro), `getTenantContext`/`ctx.tenantUserId`/`ctx.perms.canSettings`, `mergeCustomFields(acc, existing, patch, scope)`, `parseBRLToCents`/`formatCentsBRL` em `@/lib/money`, `getKitchenOrder`/`getReceiptData` já enxergam `modifiersSnapshot` (escalar do OrderItem).
- Helper `asModifierArray` (validação do Json) especificado na Task 5. Limitações do MVP documentadas (sem "2× opção", delta `>= 0`).

---

## Fase 1 — Schema + resolver + CRUD de serviço

### Task 1: Schema (models + onda-N.sql)

**Files:**
- Modify: `prisma/schema.prisma` (model `CatalogItem` ~416, model `OrderItem` ~547)
- Create: `prisma/manual/2026-07-10-onda-N-adicionais.sql`

**Step 1: Adicionar os models ao schema.prisma**

No `model CatalogItem`, adicionar a back-relation (perto de `photos`, linha ~452):

```prisma
  modifierGroups ModifierGroup[]
```

No `model OrderItem`, adicionar (perto de `customFields`, linha ~556):

```prisma
  // Adicionais precificados (onda-N): snapshot da seleção do cliente. O preço já
  // está somado em unitPriceCents; isto é só p/ exibir/imprimir o detalhamento.
  // Formato: [{ groupName, optionName, priceDeltaCents }].
  modifiersSnapshot Json?
```

No fim do arquivo (junto dos outros models de catálogo), adicionar:

```prisma
// Grupo de adicionais/variações de um item do catálogo (onda-N). Ex.: "Tamanho"
// (min1/max1 = obrigatório único), "Adicionais" (min0/maxN = opcional múltiplo).
model ModifierGroup {
  id            String         @id @default(cuid())
  accountId     String // tenant (User.id) — redundante c/ o item, mas simplifica escopo/queries
  catalogItemId String
  catalogItem   CatalogItem    @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  name          String
  minSelect     Int            @default(0) // >=1 torna o grupo obrigatório
  maxSelect     Int            @default(1) // 1 = escolha única; >1 = múltipla
  sortOrder     Int            @default(0)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  options       ModifierOption[]

  @@index([catalogItemId, sortOrder])
  @@index([accountId])
}

// Opção dentro de um grupo, com delta de preço (pode ser 0 p/ variação sem custo).
model ModifierOption {
  id              String        @id @default(cuid())
  groupId         String
  group           ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  name            String
  priceDeltaCents Int           @default(0)
  active          Boolean       @default(true)
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())

  @@index([groupId, sortOrder])
}
```

**Step 2: Escrever o SQL manual idempotente**

`prisma/manual/2026-07-10-onda-N-adicionais.sql`:

```sql
-- 2026-07-10-onda-N-adicionais.sql — Adicionais precificados (modifiers)
-- Aplicar no Supabase SQL Editor. Idempotente. NÃO criar migration versionada
-- (schema entra por AQUI, precedente da onda-L). Ver [[prod-schema-drift-destravar]].

-- 1) OrderItem: snapshot da seleção (preço já somado em unitPriceCents)
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "modifiersSnapshot" JSONB;

-- 2) ModifierGroup (por item)
CREATE TABLE IF NOT EXISTS "ModifierGroup" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ModifierGroup_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ModifierGroup_catalogItemId_sortOrder_idx"
  ON "ModifierGroup" ("catalogItemId","sortOrder");
CREATE INDEX IF NOT EXISTS "ModifierGroup_accountId_idx"
  ON "ModifierGroup" ("accountId");

-- 3) ModifierOption
CREATE TABLE IF NOT EXISTS "ModifierOption" (
  "id" TEXT PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ModifierOption_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ModifierOption_groupId_sortOrder_idx"
  ON "ModifierOption" ("groupId","sortOrder");
```

**Step 3: Regenerar o client Prisma**

PARAR o dev server antes (lock do query-engine no Windows — ver [[prisma-generate-dev-server-lock]]). Run: `npx prisma generate`
Expected: "Generated Prisma Client".

**Step 4: Aplicar o SQL no DB local (Docker) p/ os testes de integração**

Run: cole o `onda-N-adicionais.sql` no Postgres local (Docker `crm-postgres`). Expected: sem erro (re-rodar não quebra).

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/manual/2026-07-10-onda-N-adicionais.sql
git commit -m "feat(modifiers): schema de adicionais precificados (onda-N)"
```

---

### Task 2: Resolver de seleção (`modifier.service.ts`)

O coração da preço-integridade. Puro I/O + validação; sem UI.

**Files:**
- Create: `src/server/services/modifier.service.ts`
- Test: `src/server/services/modifier.service.test.ts`

**Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://t:t@localhost:5432/t?schema=public";
});
vi.mock("@/server/db/client", () => ({
  prisma: { modifierGroup: { findMany: vi.fn() } },
}));

const GROUPS = [
  { id: "g1", name: "Tamanho", minSelect: 1, maxSelect: 1, sortOrder: 0,
    options: [
      { id: "o1", name: "Média", priceDeltaCents: 0, active: true, sortOrder: 0 },
      { id: "o2", name: "Grande", priceDeltaCents: 800, active: true, sortOrder: 1 },
    ] },
  { id: "g2", name: "Adicionais", minSelect: 0, maxSelect: 3, sortOrder: 1,
    options: [
      { id: "o3", name: "Bacon", priceDeltaCents: 500, active: true, sortOrder: 0 },
      { id: "o4", name: "Cheddar", priceDeltaCents: 400, active: true, sortOrder: 1 },
      { id: "o5", name: "Fora de linha", priceDeltaCents: 100, active: false, sortOrder: 2 },
    ] },
];

describe("resolveModifierSelection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/server/db/client");
    (prisma.modifierGroup.findMany as any).mockResolvedValue(GROUPS);
  });

  it("soma os deltas e monta o snapshot na ordem dos grupos", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    const r = await resolveModifierSelection("acc", "item", ["o2", "o3"]);
    expect(r.deltaCents).toBe(1300);
    expect(r.snapshot).toEqual([
      { groupName: "Tamanho", optionName: "Grande", priceDeltaCents: 800 },
      { groupName: "Adicionais", optionName: "Bacon", priceDeltaCents: 500 },
    ]);
  });

  it("sem seleção e sem grupos obrigatórios → delta 0, snapshot null", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.modifierGroup.findMany as any).mockResolvedValue([]);
    const { resolveModifierSelection } = await import("./modifier.service");
    const r = await resolveModifierSelection("acc", "item", []);
    expect(r.deltaCents).toBe(0);
    expect(r.snapshot).toBeNull();
  });

  it("grupo obrigatório sem escolha → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", [])).rejects.toThrow(/Tamanho/);
  });

  it("acima do maxSelect → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "o2"])).rejects.toThrow(/Tamanho/);
  });

  it("opção inativa → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "o5"])).rejects.toThrow(/indisponível/i);
  });

  it("opção que não é do item → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "xxx"])).rejects.toThrow(/inválid/i);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/modifier.service.test.ts`
Expected: FAIL ("resolveModifierSelection is not a function").

**Step 3: Implementar**

```ts
import { prisma } from "@/server/db/client";

export interface ModifierSnapshotEntry {
  groupName: string;
  optionName: string;
  priceDeltaCents: number;
}
export interface ResolvedModifiers {
  deltaCents: number;
  snapshot: ModifierSnapshotEntry[] | null; // null quando não há seleção
}

/**
 * Resolve as opções escolhidas (`optionIds`) de um item CONTRA o banco: valida
 * min/max por grupo, pertencimento e atividade, e retorna o delta total + o
 * snapshot ordenado. FONTE DE VERDADE do preço dos adicionais — nunca confie no
 * client. Lança "CODE:mensagem" p/ o handler online mapear p/ 409.
 */
export async function resolveModifierSelection(
  accountId: string,
  catalogItemId: string,
  optionIds: string[],
): Promise<ResolvedModifiers> {
  const groups = await prisma.modifierGroup.findMany({
    where: { catalogItemId, accountId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });

  const chosen = new Set(optionIds);
  // Toda opção escolhida tem que ser de algum grupo do item.
  const validOptionIds = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
  for (const id of chosen) {
    if (!validOptionIds.has(id)) throw new Error("MODIFIER:Adicional inválido para este item.");
  }

  let deltaCents = 0;
  const snapshot: ModifierSnapshotEntry[] = [];
  for (const g of groups) {
    const picked = g.options.filter((o) => chosen.has(o.id));
    if (picked.some((o) => !o.active)) {
      throw new Error(`MODIFIER:Um adicional de "${g.name}" está indisponível.`);
    }
    if (picked.length < g.minSelect) {
      throw new Error(`MODIFIER:Escolha ${g.minSelect === g.maxSelect ? "" : "ao menos "}${g.minSelect} em "${g.name}".`);
    }
    if (picked.length > g.maxSelect) {
      throw new Error(`MODIFIER:Máximo de ${g.maxSelect} em "${g.name}".`);
    }
    for (const o of picked) {
      deltaCents += o.priceDeltaCents;
      snapshot.push({ groupName: g.name, optionName: o.name, priceDeltaCents: o.priceDeltaCents });
    }
  }

  return { deltaCents, snapshot: snapshot.length ? snapshot : null };
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/modifier.service.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/server/services/modifier.service.ts src/server/services/modifier.service.test.ts
git commit -m "feat(modifiers): resolver de seleção (delta + snapshot + validação)"
```

---

### Task 3: CRUD dos grupos/opções (serviço + rotas)

**Files:**
- Modify: `src/server/services/modifier.service.ts` (adicionar `listItemModifiers`/`saveItemModifiers` — NÃO em catalog.service.ts; tudo de modifier vive num arquivo só)
- Create: `src/app/api/vendas/catalog/[id]/modifiers/route.ts` (GET lista, PUT substitui o conjunto)
- Test: adicionar a `src/server/services/modifier.service.test.ts`

**Design:** um PUT "replace-all" por item (envia o conjunto completo de grupos+opções) é mais simples que CRUD granular e casa com a edição em bloco do CatalogManager. Persistência transacional: apaga os grupos do item e recria (cascade limpa as opções). IDs de opções não precisam ser estáveis (o snapshot no OrderItem já é imutável).

**Step 1: Teste de `saveItemModifiers` (replace-all) e `listItemModifiers`**

```ts
// (mesmo arquivo de teste) — mockar prisma.$transaction, modifierGroup, modifierOption
it("saveItemModifiers substitui os grupos do item (delete + create)", async () => {
  // arrange: mock tx.modifierGroup.deleteMany + create aninhado
  // act: saveItemModifiers("acc","item",[{name:"Tamanho",minSelect:1,maxSelect:1,options:[{name:"G",priceDeltaCents:800}]}])
  // assert: deleteMany chamado com { where:{ catalogItemId:"item", accountId:"acc" } } e create com options aninhadas
});
```

**Step 2: Implementar em `modifier.service.ts`**

```ts
export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceDeltaCents: number; active?: boolean }[];
}

/** Lê os grupos+opções de um item (para a UI de edição e o cardápio). */
export async function listItemModifiers(accountId: string, catalogItemId: string) {
  return prisma.modifierGroup.findMany({
    where: { catalogItemId, accountId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
}

/** Substitui TODO o conjunto de grupos/opções do item (replace-all, transacional).
 * Valida escopo (item é da conta) e sanidade (min<=max, nomes, deltas inteiros). */
export async function saveItemModifiers(
  accountId: string,
  catalogItemId: string,
  groups: ModifierGroupInput[],
): Promise<void> {
  const item = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, accountId }, select: { id: true } });
  if (!item) throw new Error("Item do catálogo não encontrado.");

  for (const g of groups) {
    if (!g.name?.trim()) throw new Error("Grupo sem nome.");
    if (!Number.isInteger(g.minSelect) || !Number.isInteger(g.maxSelect) || g.minSelect < 0 || g.maxSelect < 1 || g.minSelect > g.maxSelect) {
      throw new Error(`Limites inválidos em "${g.name}".`);
    }
    if (!g.options.length) throw new Error(`"${g.name}" precisa de ao menos uma opção.`);
    for (const o of g.options) {
      if (!o.name?.trim()) throw new Error(`Opção sem nome em "${g.name}".`);
      if (!Number.isInteger(o.priceDeltaCents) || o.priceDeltaCents < 0) throw new Error(`Preço inválido em "${o.name}".`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.modifierGroup.deleteMany({ where: { catalogItemId, accountId } });
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      await tx.modifierGroup.create({
        data: {
          accountId, catalogItemId, name: g.name.trim(),
          minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: gi,
          options: {
            create: g.options.map((o, oi) => ({
              name: o.name.trim(), priceDeltaCents: o.priceDeltaCents,
              active: o.active ?? true, sortOrder: oi,
            })),
          },
        },
      });
    }
  });
}
```

**Step 3: Rotas** — `src/app/api/vendas/catalog/[id]/modifiers/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listItemModifiers, saveItemModifiers } from "@/server/services/modifier.service";

export const dynamic = "force-dynamic";

const groupSchema = z.object({
  name: z.string().min(1),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  options: z.array(z.object({
    name: z.string().min(1),
    priceDeltaCents: z.number().int().min(0),
    active: z.boolean().optional(),
  })).min(1),
});
const putSchema = z.object({ groups: z.array(groupSchema) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ groups: await listItemModifiers(ctx.tenantUserId, id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await params;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    await saveItemModifiers(ctx.tenantUserId, id, parsed.data.groups);
    return NextResponse.json({ groups: await listItemModifiers(ctx.tenantUserId, id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

**Step 4/5:** rodar testes + `npm run lint` + commit `feat(modifiers): CRUD replace-all de grupos/opções por item`.

---

## Fase 2 — Definição no PDV (CatalogManager)

### Task 4: Editor de adicionais no CatalogManager

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx` (bloco de edição PRODUTO, perto de `CatalogItemSpecs` ~linha 593)
- Create: `src/components/vendas/ModifierGroupsEditor.tsx`

**Especificação (UI, sem TDD):** Um componente `ModifierGroupsEditor({ catalogItemId })` que:
- No mount, `GET /api/vendas/catalog/{id}/modifiers` e popula o estado local (lista de grupos, cada um com nome, min/max e opções nome+delta).
- Permite adicionar/remover grupo; por grupo, um seletor de tipo que mapeia para min/max: "Escolha única obrigatória" (1/1), "Única opcional" (0/1), "Múltipla" (0/N com N = nº de opções ou campo maxSelect), "Múltipla obrigatória" (1/N).
- Por opção: nome + preço (usa `parseBRLToCents`/`formatCentsBRL` de `@/lib/money`, como o resto do form).
- Botão "Salvar adicionais" → `PUT` com o conjunto; mostra "Salvo ✓" / erro.
- Só aparece para itens já criados (precisa de `catalogItemId`) e quando `canEdit`.

Integração: renderizar `<ModifierGroupsEditor catalogItemId={item.id} />` no bloco de edição do item, logo após `CatalogItemSpecs` (linha ~593). Seguir o estilo de `Card`/inputs já usado no arquivo.

**Verificação manual:** dev server, abrir Catálogo, editar um produto, criar grupo "Tamanho" (única obrigatória) com Média R$0 / Grande R$8, e "Adicionais" (múltipla) com Bacon R$5. Salvar, recarregar, conferir persistência. Tema claro/escuro.

**Commit:** `feat(modifiers): editor de grupos/opções no catálogo`.

---

## Fase 3 — Núcleo de preço no pedido (`addItem`) + PDV

### Task 5: `addItem` aceita adicionais e soma no preço

**Files:**
- Modify: `src/server/services/order.service.ts` (`OrderItemDTO` ~16, `addItem` ~124-158, `toDTO` ~49-80)
- Modify: `src/server/services/order.service.test.ts`

**Step 1: Teste falhando** (mockando `resolveModifierSelection`):

```ts
vi.mock("./modifier.service", () => ({ resolveModifierSelection: vi.fn() }));
// ...
it("addItem soma o delta dos adicionais no unitPriceCents e grava o snapshot", async () => {
  // catalogItem base priceCents=2000; resolver → { deltaCents:1300, snapshot:[...] }
  // addItem(acc, order, { catalogItemId, modifierOptionIds:["o2","o3"] })
  // espera orderItem.create com unitPriceCents:3300 e modifiersSnapshot: [...]
});
it("addItem sem modifierOptionIds → comportamento atual (sem snapshot)", async () => { /* ... */ });
```

**Step 2: Ver falhar.**

**Step 3: Implementar** — estender `addItem` (assinatura ganha `modifierOptionIds?: string[]`):

```ts
// no topo do arquivo:
import { resolveModifierSelection } from "./modifier.service";
import type { ModifierSnapshotEntry } from "./modifier.service";

// OrderItemDTO ganha: modifiers: ModifierSnapshotEntry[] | null;

export async function addItem(
  accountId: string,
  orderId: string,
  data: { catalogItemId?: string; name?: string; unitPriceCents?: number; quantity?: number;
          customFields?: Record<string, unknown>; modifierOptionIds?: string[] },
): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const qty = Math.max(1, Math.floor(data.quantity ?? 1));

  let nameSnapshot: string;
  let unitPriceCents: number;
  let catalogItemId: string | null = null;

  if (data.catalogItemId) {
    const ci = await prisma.catalogItem.findFirst({ where: { id: data.catalogItemId, accountId } });
    if (!ci) throw new Error("Item do catálogo não encontrado.");
    nameSnapshot = ci.name; unitPriceCents = ci.priceCents; catalogItemId = ci.id;
  } else {
    if (!data.name?.trim()) throw new Error("Informe o item.");
    if (!Number.isInteger(data.unitPriceCents) || (data.unitPriceCents ?? -1) < 0) throw new Error("Preço inválido.");
    nameSnapshot = data.name.trim(); unitPriceCents = data.unitPriceCents!;
  }

  // Adicionais: só p/ item de catálogo. Resolve o delta pelo banco e soma no preço.
  let modifiersSnapshot: ModifierSnapshotEntry[] | null = null;
  if (catalogItemId && data.modifierOptionIds?.length) {
    const r = await resolveModifierSelection(accountId, catalogItemId, data.modifierOptionIds);
    unitPriceCents += r.deltaCents;
    modifiersSnapshot = r.snapshot;
  } else if (catalogItemId) {
    // valida grupos obrigatórios mesmo sem escolha (lança se faltar)
    const r = await resolveModifierSelection(accountId, catalogItemId, []);
    modifiersSnapshot = r.snapshot; // null
  }

  const customFields = data.customFields
    ? await mergeCustomFields(accountId, null, data.customFields, "ORDER_ITEM")
    : undefined;

  await prisma.orderItem.create({
    data: {
      orderId, catalogItemId, nameSnapshot, unitPriceCents, quantity: qty,
      ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
      ...(modifiersSnapshot ? { modifiersSnapshot: modifiersSnapshot as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  return toDTO(await loadOwned(accountId, orderId));
}
```

Atualizar `OrderItemDTO` (~linha 16), o **tipo inline do parâmetro de `toDTO`** (linha ~57 — o `items: {...}[]` precisa ganhar `modifiersSnapshot?: Prisma.JsonValue | null`), e o `.map` de `toDTO` (linha ~59). `loadOwned` já traz o campo (o `include: { items: {...} }` retorna todos os escalares — não precisa mexer no include). Adicionar o helper puro e usá-lo:

```ts
function asModifierArray(v: Prisma.JsonValue | null | undefined): ModifierSnapshotEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: ModifierSnapshotEntry[] = [];
  for (const e of v) {
    if (e && typeof e === "object" && !Array.isArray(e)) {
      const r = e as Record<string, unknown>;
      if (typeof r.groupName === "string" && typeof r.optionName === "string" && typeof r.priceDeltaCents === "number") {
        out.push({ groupName: r.groupName, optionName: r.optionName, priceDeltaCents: r.priceDeltaCents });
      }
    }
  }
  return out.length ? out : null;
}
```

No `.map` de `toDTO`: `modifiers: asModifierArray(i.modifiersSnapshot)`. Em `OrderItemDTO`, adicionar `modifiers: ModifierSnapshotEntry[] | null;`.

**Step 4: Ver passar.** **Step 5: Commit** `feat(modifiers): addItem soma delta e grava snapshot`.

**Nota — grupos obrigatórios via IA/avulso:** a chamada `resolveModifierSelection(acc, item, [])` faz `addItem` recusar item com grupo obrigatório e sem escolha. Isso vale para PDV, IA e cardápio de graça. Confirmar que o seed/knowledge não quebra (itens sem grupos passam com `[]`).

**Nota de custo (aceito):** `addItem` passa a fazer **1 `modifierGroup.findMany` (indexado por catalogItemId) por item de catálogo adicionado**, mesmo sem adicionais, para validar grupos obrigatórios. No checkout online (Fase 5) isso soma a resolução feita no `placeOnlineOrder` → 2 resoluções por linha. Aceitável no MVP (query indexada, poucos itens/pedido). NÃO otimizar prematuramente.

**Limitações do MVP (documentar, não implementar):** (a) uma opção não pode ser escolhida 2× no mesmo item ("2× bacon") — `new Set(optionIds)` deduplica; (b) `priceDeltaCents` é `>= 0` (sem adicional que reduz preço, ex.: "sem queijo −R$2").

### Task 6: Rota de items aceita adicionais + seletor no OrderBoard

**Files:**
- Modify: `src/app/api/vendas/orders/[id]/items/route.ts` (`addSchema` ~8-14)
- Modify: `src/components/vendas/OrderBoard.tsx` (`addFromCatalog` ~493-501, botão ~632, merge ~495)
- Modify: `src/server/services/catalog.service.ts` (`CatalogItemDTO` ~8-28, `toDTO` ~65-78, `listCatalogItems` ~116) — expor `hasModifiers`
- Create: `src/components/menu/ModifierPicker.tsx` (modal de seleção — **local COMPARTILHADO**, reusado pelo cardápio na Fase 5; NÃO em components/vendas)

**Rota:** adicionar `modifierOptionIds: z.array(z.string()).optional()` ao `addSchema`. O `POST` já repassa `parsed.data` inteiro a `addItem` (linha 24) → nada mais a mudar na rota.

**`hasModifiers` no catálogo (determinístico, sem N+1 por clique):** em `listCatalogItems`, adicionar ao `findMany` `include: { _count: { select: { modifierGroups: true } } }`; em `CatalogItemDTO` e no `toDTO`, expor `hasModifiers: boolean` (= `_count.modifierGroups > 0`). Assim o board sabe, sem fetch por clique, se deve abrir o seletor. Ao abrir, o `ModifierPicker` busca os grupos completos via `GET /api/vendas/catalog/{id}/modifiers`.

**OrderBoard:** `addFromCatalog(id)` checa `item.hasModifiers`. Se `true` → abrir `<ModifierPicker>` (que faz o GET dos grupos); ao confirmar, `POST /items` com `modifierOptionIds`. Se `false` → fluxo atual.

**Merge (linha ~495):** a regra "item já existe → incrementa" só pode fundir linhas com **a mesma seleção**. Regra simples: itens COM adicionais nunca fundem (sempre linha nova); só itens sem `modifiersSnapshot` seguem fundindo por `catalogItemId`.

**Render da linha (~676-742):** abaixo do nome, se `it.modifiers`, listar em texto pequeno "+ Grande, + Bacon" (cosmético).

**ModifierPicker:** modal que recebe os grupos, renderiza radio (maxSelect=1) ou checkbox (maxSelect>1) por grupo, valida min/max no client (botão confirmar desabilitado se inválido), mostra o preço somado ao vivo. Retorna a lista de `optionId`.

**Verificação manual:** PDV, adicionar um hambúrguer com Tamanho Grande + Bacon → linha entra a R$33,00 (20+8+5), duas adições com escolhas diferentes = duas linhas.

**Commit:** `feat(modifiers): seletor de adicionais no PDV`.

---

## Fase 4 — Recibo + comanda de cozinha

### Task 7: Sub-linhas de adicionais no cupom e na cozinha

**⚠️ CRÍTICO — o total NÃO pode mudar.** `buildReceiptModel` recalcula o total a partir de `lines[].totalCents` (model.ts linhas 120/124), e `l.totalCents = it.unitPriceCents * qty` já inclui os deltas. Portanto as sub-linhas de adicionais são **puramente cosméticas** e NÃO podem entrar na soma. Solução: adicionar um campo `subLines: string[]` ao `ReceiptLine` (strings já renderizadas, SEM `totalCents`), que os dois renderizadores imprimem sob a linha do item. Como `subLines` não tem `totalCents`, o `reduce` da linha 120 as ignora automaticamente. **As sub-linhas mostram só o NOME do adicional** (ex.: `+ Grande`, `+ Bacon`), sem preço — o preço já está embutido no total da linha do item; mostrar o delta parcial confundiria o leitor (não fecharia a conta visualmente).

**Files:**
- Modify: `src/lib/receipt/model.ts` — `ReceiptOrderItem` (~20-24: add `modifiers?: { optionName: string }[]`), `ReceiptLine` (~46-51: add `subLines: string[]`), `.map` de `buildReceiptModel` (~108-118: preencher `subLines`)
- Modify: `src/components/vendas/ReceiptDocument.tsx` — renderizar `line.subLines` (indentadas, menor) sob cada item (N1/HTML)
- Modify: `src/lib/receipt/escpos.ts` — imprimir cada string de `line.subLines` como uma linha própria (N2/bytes)
- Modify: `src/lib/receipt/kitchen.ts` — `KitchenItemInput` (~8-13: já tem `note`; add `modifiers?: string[]`), `buildKitchenTickets` (~42-44: renderizar os adicionais junto do item/nota)
- Modify: `src/server/services/order.service.ts` — `getReceiptData` (~553-557: mapear `modifiers` do item para `[{ optionName }]`), `getKitchenOrder` (~592-598: `modifiers: extrair optionNames do modifiersSnapshot`)
- Test: `src/lib/receipt/model.test.ts`, `src/lib/receipt/kitchen.test.ts`, `src/lib/receipt/escpos.test.ts`

**Step 1: Testes**
- `model.test.ts`: item com `modifiers: [{optionName:"Grande"},{optionName:"Bacon"}]` → a `ReceiptLine` correspondente tem `subLines` com 2 entradas (`+ Grande`, `+ Bacon`); **e o `totals.totalCents` é idêntico ao caso sem `modifiers`** (assert explícito de que sub-linha não soma).
- `escpos.test.ts`: os bytes contêm as strings das sub-linhas.
- `kitchen.test.ts`: a comanda de cozinha lista os adicionais do item.

**Step 2/3: Implementar**
- `model.ts`: `ReceiptLine` ganha `subLines: string[]` (sempre presente, `[]` quando não há). No `.map`, após montar a linha do item: `subLines: (it.modifiers ?? []).map((m) => padRow("  + " + m.optionName, "", width))` (ou string simples indentada; sem valor à direita). NÃO tocar em `subtotalCents`/`totalCents`.
- `ReceiptDocument.tsx`: para cada linha, após o nome/valor, renderizar `line.subLines` (uma `<div>` por sub-linha, indentada, `text-xs` cinza).
- `escpos.ts`: no laço que imprime `model.lines`, após a linha do item, imprimir cada `subLine` como uma linha de texto (mesma largura da bobina).
- `getReceiptData`: `modifiers: (i.modifiers ?? []).map((m) => ({ optionName: m.optionName }))`.
- `kitchen.ts` + `getKitchenOrder`: `KitchenItemInput.modifiers?: string[]`; popular com `(i.modifiers ?? []).map((m) => m.optionName)` (o `getKitchenOrder` lê o `modifiersSnapshot` do item — reusar `asModifierArray` do order.service, ou mapear inline); renderizar junto da `note` existente.

**Step 4/5:** testes (incluindo o assert "total imutável") + commit `feat(modifiers): adicionais no cupom e na comanda de cozinha`.

---

## Fase 5 — Cardápio público (opcional; entrega o delivery ponta-a-ponta)

### Task 8: Menu DTO expõe os grupos

**Files:** `src/server/services/menu.service.ts` (`MenuItemDTO` ~4-12, `getPublicMenu` ~30-71)

Incluir `modifierGroups` no `include` e no DTO (grupos+opções ativas com nome/delta/min/max). Teste do menu service cobrindo o novo campo.

**Commit:** `feat(modifiers): cardápio público expõe grupos de adicionais`.

### Task 9: Modal de item no MenuStorefront + carrinho com escolhas

**Files:** `src/components/delivery/MenuStorefront.tsx` (card ~157-219, botão `+` ~208-216, cart `Record<string,number>` ~44-52), `src/components/delivery/CheckoutForm.tsx` (`lines` ~65-67, body ~92-108)

**Especificação:** quando o item tem grupos, o `+` abre o `ModifierPicker` já criado na Task 6 (`src/components/menu/ModifierPicker.tsx` — compartilhado, sem reescrever); o carrinho passa de `Record<id, qty>` para uma lista de linhas `{ catalogItemId, quantity, optionIds }` (cada combinação distinta = uma linha). O menu público precisa expor os grupos por item (Task 8) para o picker montar sem fetch extra, OU o picker faz `GET` público — decidir na Task 8 (recomendado: embutir no menu DTO, já que a página é server-rendered). `CheckoutForm` envia `items: [{ catalogItemId, quantity, optionIds, note? }]`. Recalcular o subtotal exibido somando os deltas (cosmético; o servidor manda no preço final).

**Commit:** `feat(modifiers): seleção de adicionais no cardápio público`.

### Task 10: Validação server-side no checkout

**Files:** `src/app/api/cardapio/[slug]/pedido/route.ts` (`bodySchema.items` ~20-28, **`KNOWN_CODES` ~43**), `src/server/services/online-order.service.ts` (subtotal ~55-59, `addItem` ~93-99)

**⚠️ Adicionar `"MODIFIER"` ao array `KNOWN_CODES`** (route.ts linha 43) — senão o erro `MODIFIER:...` do resolver cai no 400 genérico ("Erro ao registrar o pedido.") e o cliente não vê "Escolha o tamanho". Com o código na lista, vira 409 com a mensagem limpa.

**Step 1: Teste** (`online-order.service.test.ts`): pedido com `optionIds` → subtotal inclui os deltas; opção inválida/obrigatória faltando → erro `MODIFIER:` (handler mapeia p/ 409).

**Step 2/3:**
- Schema (`bodySchema.items`) aceita `optionIds: z.array(z.string()).optional()` por item.
- No `placeOnlineOrder`, resolver os adicionais de TODAS as linhas ANTES de calcular o subtotal (é `async` → usar `Promise.all`/`for...of await`, não dentro do `reduce` síncrono da linha 56). Para cada linha: `const r = await resolveModifierSelection(accountId, li.catalogItemId, li.optionIds ?? [])` e somar `(base + r.deltaCents) * qty`. O resolver lança `MODIFIER:...` → o `route.ts` mapeia para 409 **desde que `MODIFIER` esteja em `KNOWN_CODES`** (ver o ⚠️ acima).
- Passar `modifierOptionIds: li.optionIds` ao `addItem` (linhas 93-99). O Pix (linha 127) usa o subtotal já com deltas → cobra certo. (Aceita-se a dupla resolução: aqui p/ subtotal e de novo dentro do `addItem` — ver nota de custo na Task 5.)

**Step 4/5:** testes + commit `feat(modifiers): checkout online valida e precifica adicionais no servidor`.

---

## Fase 6 — IA ciente dos adicionais (opcional)

### Task 11: Formatar adicionais no contexto da IA

**Files:** `src/server/ai/attendance-context.ts` (`renderCatalogForAI` ~62-73 linha de preço ~65; `renderCatalogForTools` ~140-161), opcional a tool `criar_comanda` em `src/server/ai/tools/attendance-tools.ts` (~148-209)

**Especificação:** nas funções de render, quando o item tem grupos, anexar as opções com preço em texto ("Tamanho: Média / Grande (+R$8); Adicionais: Bacon (+R$5), Cheddar (+R$4)") para a IA saber oferecer/confirmar. Precisa incluir os grupos na query que alimenta esses renderizadores (verificar `loadCatalogBlock` em `conversation.service.ts:801-815`). MVP: só o texto passivo (IA menciona), sem a IA montar a seleção via tool. Estender a tool `criar_comanda` para aceitar `opcionais` por item é um passo extra opcional (schema ~155-173 + `readItens` ~124-140 → passar `modifierOptionIds` ao `addItem`).

**Commit:** `feat(modifiers): IA conhece os adicionais e preços`.

---

## Deploy (após as fases desejadas)

1. Aplicar `prisma/manual/2026-07-10-onda-N-adicionais.sql` no **Supabase** (idempotente; ANTES do deploy do código, senão o catálogo/pedido 500). Ver [[prod-schema-drift-destravar]].
2. Gate: `npx tsc --noEmit` + `npx vitest run` + `npx next lint` limpos.
3. Deploy web via Vercel CLI (worker não precisa — sem código de delivery). Ver [[vercel-hobby-push-block]].
4. Smoke: criar grupo num item de teste, adicionar no PDV, conferir preço somado e cupom; se Fase 5, um pedido no cardápio com adicional pago-online e conferir o valor do Pix.

**Opt-in por natureza:** item sem grupos = comportamento idêntico ao atual. A feature é inerte até alguém cadastrar um grupo.
