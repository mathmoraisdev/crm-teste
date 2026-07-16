# Comandas, Catálogo e Relatórios (registro de vendas) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar a qualquer negócio pequeno um módulo operacional para **cadastrar serviços/produtos com preço**, **registrar vendas do dia em comandas** (ligadas a um Lead do CRM ou avulsas) e **ver relatórios básicos de faturamento** — substituindo o caderno de anotações, sem depender da IA nem de pagamento online.

**Architecture:** Três modelos Prisma novos por DONO da conta (`tenantUserId`), no mesmo padrão multi-tenant do resto do schema (`accountId` desnormalizado + `onDelete: Cascade`): `CatalogItem` (item vendável), `Order` (comanda) e `OrderItem` (linha da comanda com **snapshot** de nome/preço, igual `Sale.amountCents` já faz). O total da comanda é **derivado dos itens** (não desnormalizado — YAGNI). Uma única rota de página `/vendas` com três abas client-side (Comandas · Catálogo · Relatórios). Relatórios são **agregações** (`groupBy`/`aggregate`) sobre comandas fechadas — baratos porque o dado já existe. Reaproveita `src/lib/money.ts` (centavos ↔ BRL), o padrão de rota `getTenantContext` e os componentes `Card`/`Button`.

**Tech Stack:** Next.js (App Router, RSC + client components) · Prisma + Postgres · Zod · TailwindCSS · Vitest (testes co-locados `*.test.ts`).

**Escopo (o que NÃO entra na v1):** cobrança Pix no fechamento (só registro); exportação CSV; gráficos; seletor de intervalo custom; **relatório por operador** (o dado `openedById` é gravado agora, mas o filtro/relatório por pessoa fica pra v2 premium). Edição de quantidade de uma linha = remover e re-adicionar.

**Decisões de produto já tomadas (do dono):**
- **Sem gate de plano** — o módulo entra em TODOS os planos, incluindo Inicial. NÃO usar `assertFeature` (diferente de `offer.service.ts`). Custo de operação ~zero (só banco), então não há razão de margem pra trancar; é o coração do pitch "substitui o caderno".
- **Comanda liga a Lead OU é avulsa** (`leadId` opcional + `customerName` livre).
- **Preço não muda agora**; reavaliar depois com dados.

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest. Arquivos co-locados: `foo.ts` → `foo.test.ts`. Rode um específico: `npx vitest run caminho/arquivo.test.ts`.
- **Schema:** dev usa `npx prisma db push`. **Produção** tem cutover pendente para `migrate deploy` (ver memória `crm-inbox-db-push-pending`) — NÃO rode migrate em prod aqui. Cada mudança de schema ganha um SQL manual idempotente em `prisma/manual/` (padrão do branding em `prisma/manual/2026-07-03-account-branding.sql`), aplicado no Supabase SQL Editor de prod pelo dono.
- **Dinheiro:** SEMPRE centavos (`Int`) no banco e na lógica. Use `parseBRLToCents` / `formatCentsBRL` de `src/lib/money.ts` só na borda (UI/parse de input). Nunca float pra dinheiro.
- **Tenancy:** o dono é `ctx.tenantUserId` (via `getTenantContext()` em `src/lib/tenant.ts`). Todo dado é escopado por `accountId = ctx.tenantUserId`. `openedById = ctx.sessionUserId` (quem operou).
- **Rotas de API:** espelhe `src/app/api/account/pipeline-labels/route.ts` — `dynamic = "force-dynamic"`, `getTenantContext()`, 401 sem sessão, 403 sem `perms.canSettings` quando fizer sentido, zod no body, `try/catch` devolvendo `{ error }` legível (NUNCA deixar 500 de corpo vazio — lição do branding).
- **Commits frequentes** ao fim de cada task.

---

## Visão geral das fases

- **Fase 0** — Schema (`CatalogItem` / `Order` / `OrderItem` + enums) + push dev + SQL manual de prod.
- **Fase 1** — Catálogo: service (TDD) + API + aba de gestão.
- **Fase 2** — Comandas: service (abrir/adicionar/remover/fechar, com total derivado — TDD) + API + workspace operacional.
- **Fase 3** — Relatórios: service de agregação (TDD) + aba de relatórios.
- **Fase 4** — Página `/vendas` com abas + item na navegação. Verificação E2E.

Cada fase é entregável e reversível de forma independente.

---

# FASE 0 — Modelos de dados

## Task 0.1: Enums + modelos no schema

**Files:**
- Modify: `prisma/schema.prisma` (adicionar enums + 3 models + relações inversas em `User` e `Lead`)

**Step 1: Adicionar os enums** (perto dos outros enums, ex.: após `enum PaymentMethod`):

```prisma
enum CatalogItemKind {
  SERVICO
  PRODUTO
}

enum OrderStatus {
  ABERTA
  FECHADA
}

// Forma de pagamento da COMANDA. Enum próprio (o PaymentMethod existente é do
// billing e não tem DINHEIRO, que o balcão precisa).
enum OrderPayment {
  DINHEIRO
  PIX
  CARTAO
  OUTRO
}
```

**Step 2: Adicionar os 3 models** (após o model `AccountBranding`, por proximidade de "por conta"):

```prisma
// Item vendável do catálogo da conta (serviço ou produto). Fonte de verdade do
// preço. Por DONO (tenant), não por número de WhatsApp (diferente de Offer, que
// é do funil de Pix). Ausência de catálogo = conta ainda não cadastrou nada.
model CatalogItem {
  id         String          @id @default(cuid())
  accountId  String // User.id do dono (tenantUserId)
  account    User            @relation(fields: [accountId], references: [id], onDelete: Cascade)
  kind       CatalogItemKind @default(SERVICO)
  name       String
  priceCents Int // preço em centavos (BRL)
  active     Boolean         @default(true)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
  orderItems OrderItem[]

  @@index([accountId, active])
}

// Comanda: uma venda/atendimento registrado. Liga a um Lead do CRM OU é avulsa
// (customerName). O total é DERIVADO dos itens (não desnormalizado).
model Order {
  id           String        @id @default(cuid())
  accountId    String // User.id do dono (tenant)
  account      User          @relation("OrderAccount", fields: [accountId], references: [id], onDelete: Cascade)
  leadId       String? // opcional: comanda ligada a um lead
  lead         Lead?         @relation(fields: [leadId], references: [id], onDelete: SetNull)
  customerName String? // nome avulso quando não há lead
  status       OrderStatus   @default(ABERTA)
  openedById   String // User.id de quem abriu (operador) — atribuição p/ relatório futuro
  openedBy     User          @relation("OrderOpenedBy", fields: [openedById], references: [id])
  payment      OrderPayment? // definido no fechamento
  note         String?
  createdAt    DateTime      @default(now())
  closedAt     DateTime? // quando foi fechada (FECHADA)
  items        OrderItem[]

  @@index([accountId, status])
  @@index([accountId, closedAt])
}

// Linha de uma comanda. Guarda SNAPSHOT de nome/preço: reajustar o catálogo
// depois não altera comandas antigas. catalogItemId é opcional (permite linha
// avulsa e sobrevive à exclusão do item do catálogo).
model OrderItem {
  id             String       @id @default(cuid())
  orderId        String
  order          Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  catalogItemId  String?
  catalogItem    CatalogItem? @relation(fields: [catalogItemId], references: [id], onDelete: SetNull)
  nameSnapshot   String
  unitPriceCents Int
  quantity       Int          @default(1)
  createdAt      DateTime     @default(now())

  @@index([orderId])
}
```

> **Atenção às relações nomeadas:** `Order` tem DUAS relações para `User` (`account` e `openedBy`), então o Prisma exige nomes (`"OrderAccount"` / `"OrderOpenedBy"`). As inversas em `User` precisam bater com esses nomes.

**Step 3: Relações inversas.** Em `model User`, junto das outras relações (ex.: perto de `branding`):

```prisma
  catalogItems CatalogItem[]
  orders       Order[]       @relation("OrderAccount")
  ordersOpened Order[]       @relation("OrderOpenedBy")
```

Em `model Lead`, junto das relações do lead:

```prisma
  orders Order[]
```

**Step 4: Aplicar no banco de dev**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." + client regenerado.
Run (se necessário): `npx prisma generate`

Run: `npx tsc --noEmit`
Expected: sem erros novos.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(vendas): modelos CatalogItem/Order/OrderItem (registro de vendas por conta)"
```

---

## Task 0.2: SQL manual para produção (não aplicar aqui)

**Files:**
- Create: `prisma/manual/2026-07-03-vendas.sql`

Espelha o DDL do Prisma para aplicação manual em prod (cutover para migrate pendente). Idempotente e aditivo. Confira o SQL real gerado com `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma` **não** — em vez disso, gere o DDL exato com:

Run: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` e copie SÓ os blocos das tabelas novas e enums novos (CatalogItem, Order, OrderItem, CatalogItemKind, OrderStatus, OrderPayment), adaptando para idempotência.

**Conteúdo** (ajuste os tipos exatamente ao que o Prisma gerar; modelo abaixo é o esperado):

```sql
-- Cria CatalogItem/Order/OrderItem (módulo de registro de vendas).
-- Aplicar em PROD manualmente (Supabase SQL Editor) — cutover p/ migrate pendente.
-- Idempotente e ADITIVO. Bate com o DDL gerado pelo Prisma.

DO $$ BEGIN CREATE TYPE "CatalogItemKind" AS ENUM ('SERVICO', 'PRODUTO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderStatus" AS ENUM ('ABERTA', 'FECHADA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderPayment" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CatalogItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "CatalogItemKind" NOT NULL DEFAULT 'SERVICO',
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_active_idx" ON "CatalogItem"("accountId", "active");

CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT,
    "customerName" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'ABERTA',
    "openedById" TEXT NOT NULL,
    "payment" "OrderPayment",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Order_accountId_status_idx" ON "Order"("accountId", "status");
CREATE INDEX IF NOT EXISTS "Order_accountId_closedAt_idx" ON "Order"("accountId", "closedAt");

CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");

DO $$ BEGIN ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Order" ADD CONSTRAINT "Order_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

> **Importante:** confira que o DDL acima bate 1:1 com o de `migrate diff` (nomes de índice/constraint que o Prisma gera). Se divergir, use o do Prisma — ele é a fonte de verdade.

**Step 2: Commit** (só registro; aplicação em prod é manual pelo dono)

```bash
git add prisma/manual/2026-07-03-vendas.sql
git commit -m "chore(db): SQL manual das tabelas de vendas (aplicação manual em prod)"
```

---

# FASE 1 — Catálogo

## Task 1.1: Serviço de catálogo (com teste)

**Files:**
- Create: `src/server/services/catalog.service.ts`
- Test: `src/server/services/catalog.service.test.ts`

Regras: escopo por `accountId`; `name` obrigatório; `priceCents` inteiro ≥ 0 (permite cortesia/R$0). SEM `assertFeature` (todos os planos). Ordena ativos primeiro, depois por nome.

**Step 1: Teste que falha** (usa o banco de dev — padrão dos outros `*.service.test.ts` que tocam Prisma; se preferir isolar, veja `offer.service.test.ts`):

```ts
// src/server/services/catalog.service.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem, listCatalogItems, updateCatalogItem, deleteCatalogItem } from "./catalog.service";

// Cria um usuário-dono descartável por teste (isolamento).
async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cat_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("catalog.service", () => {
  it("cria item e lista escopado por conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createCatalogItem(a, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    await createCatalogItem(b, { name: "X-Burguer", priceCents: 2500, kind: "PRODUTO" });
    const listA = await listCatalogItems(a);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("Corte");
    expect(listA[0].priceCents).toBe(4000);
  });

  it("rejeita nome vazio e preço negativo", async () => {
    const a = await makeOwner();
    await expect(createCatalogItem(a, { name: "  ", priceCents: 1000 })).rejects.toThrow();
    await expect(createCatalogItem(a, { name: "X", priceCents: -1 })).rejects.toThrow();
  });

  it("update só afeta item da própria conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const item = await createCatalogItem(a, { name: "Barba", priceCents: 3000 });
    await expect(updateCatalogItem(b, item.id, { priceCents: 1 })).rejects.toThrow();
    const upd = await updateCatalogItem(a, item.id, { priceCents: 3500, active: false });
    expect(upd.priceCents).toBe(3500);
    expect(upd.active).toBe(false);
  });

  it("delete remove o item", async () => {
    const a = await makeOwner();
    const item = await createCatalogItem(a, { name: "Sobrancelha", priceCents: 1500 });
    await deleteCatalogItem(a, item.id);
    expect(await listCatalogItems(a)).toHaveLength(0);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/catalog.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```ts
// src/server/services/catalog.service.ts
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { CatalogItemKind } from "@prisma/client";

export interface CatalogItemDTO {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  active: boolean;
}

const upsertSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  priceCents: z.number().int().min(0, "Preço não pode ser negativo."),
  kind: z.enum(["SERVICO", "PRODUTO"]).default("SERVICO"),
});

function toDTO(o: { id: string; kind: CatalogItemKind; name: string; priceCents: number; active: boolean }): CatalogItemDTO {
  return { id: o.id, kind: o.kind, name: o.name, priceCents: o.priceCents, active: o.active };
}

export async function createCatalogItem(
  accountId: string,
  data: { name: string; priceCents: number; kind?: CatalogItemKind },
): Promise<CatalogItemDTO> {
  const parsed = upsertSchema.parse(data);
  const item = await prisma.catalogItem.create({
    data: { accountId, name: parsed.name, priceCents: parsed.priceCents, kind: parsed.kind },
  });
  return toDTO(item);
}

export async function listCatalogItems(accountId: string, opts?: { activeOnly?: boolean }): Promise<CatalogItemDTO[]> {
  const items = await prisma.catalogItem.findMany({
    where: { accountId, ...(opts?.activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return items.map(toDTO);
}

export async function updateCatalogItem(
  accountId: string,
  id: string,
  data: { name?: string; priceCents?: number; kind?: CatalogItemKind; active?: boolean },
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
  const item = await prisma.catalogItem.update({ where: { id }, data: patch });
  return toDTO(item);
}

export async function deleteCatalogItem(accountId: string, id: string): Promise<void> {
  const owned = await prisma.catalogItem.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.catalogItem.delete({ where: { id } });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/catalog.service.test.ts`
Expected: PASS (4 testes).

**Step 5: Commit**

```bash
git add src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(vendas): catalog.service (CRUD de itens do catálogo por conta)"
```

---

## Task 1.2: API do catálogo

**Files:**
- Create: `src/app/api/vendas/catalog/route.ts` (GET lista, POST cria)
- Create: `src/app/api/vendas/catalog/[id]/route.ts` (PATCH, DELETE)

**Step 1: `route.ts`** (lista + cria):

```ts
// src/app/api/vendas/catalog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { createCatalogItem, listCatalogItems } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const items = await listCatalogItems(ctx.tenantUserId);
  return NextResponse.json({ items });
}

const createSchema = z.object({
  name: z.string(),
  priceCents: z.number().int(),
  kind: z.enum(["SERVICO", "PRODUTO"]).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const item = await createCatalogItem(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
```

**Step 2: `[id]/route.ts`** (edita/exclui):

```ts
// src/app/api/vendas/catalog/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { updateCatalogItem, deleteCatalogItem } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  priceCents: z.number().int().optional(),
  kind: z.enum(["SERVICO", "PRODUTO"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const item = await updateCatalogItem(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    await deleteCatalogItem(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

> Confirme a assinatura de `params` (Promise vs objeto) conferindo outra rota `[id]` do projeto, ex.: `src/app/api/numbers/[id]/offers/[offerId]/route.ts`. Use a mesma forma.

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/app/api/vendas/catalog
git commit -m "feat(vendas): API do catálogo (list/create/patch/delete)"
```

---

## Task 1.3: UI — gestão do catálogo

**Files:**
- Create: `src/components/vendas/CatalogManager.tsx`

Client component: lista os itens (nome, tipo, preço formatado, toggle ativo), form de adicionar (nome + tipo + preço com `parseBRLToCents`), editar inline e excluir. Padrão visual do `OffersManager.tsx` / `CustomFieldsManager.tsx`.

**Step 1: Componente** (esboço — siga os componentes `Card`/`Button` e `formatCentsBRL`/`parseBRLToCents`):

```tsx
// src/components/vendas/CatalogManager.tsx
"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";

interface Item { id: string; kind: "SERVICO" | "PRODUTO"; name: string; priceCents: number; active: boolean; }

export function CatalogManager({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<"SERVICO" | "PRODUTO">("SERVICO");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/vendas/catalog");
    const d = await r.json();
    setItems(d.items ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setError(null);
    const cents = parseBRLToCents(price);
    if (!name.trim()) return setError("Informe o nome.");
    if (cents === null) return setError("Preço inválido.");
    const r = await fetch("/api/vendas/catalog", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), priceCents: cents, kind }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return setError(d.error ?? "Erro ao salvar"); }
    setName(""); setPrice(""); load();
  }
  // toggleActive(id, active) → PATCH; remove(id) → DELETE; ambos chamam load()

  return (
    <Card>
      <CardHeader title="Catálogo" subtitle="Cadastre seus serviços e produtos com preço. Eles aparecem na hora de montar uma comanda." />
      {/* form de adicionar + lista com formatCentsBRL(item.priceCents) */}
      {/* ...campos: name, kind (select SERVICO/PRODUTO), price (input BRL), botão Adicionar (disabled se !canEdit) */}
      {error && <p className="px-4 py-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
```

**Step 2: Verificar** — será montado na página `/vendas` (Fase 4). Aqui só garanta `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/vendas/CatalogManager.tsx
git commit -m "feat(vendas): UI de gestão do catálogo"
```

---

# FASE 2 — Comandas

## Task 2.1: Serviço de comandas (com teste) — o coração

**Files:**
- Create: `src/server/services/order.service.ts`
- Test: `src/server/services/order.service.test.ts`

Funções: `openOrder`, `addItem`, `removeItem`, `closeOrder`, `listOpenOrders`, `getOrder`, e o puro `orderTotalCents(items)`. Tudo escopado por `accountId`. **Total é derivado** (`Σ unitPriceCents * quantity`). Ao adicionar item vindo do catálogo, faz **snapshot** de `name`/`priceCents`.

**Step 1: Teste que falha** (foco no total e no ciclo abrir→adicionar→fechar):

```ts
// src/server/services/order.service.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, removeItem, closeOrder, listOpenOrders, orderTotalCents } from "./order.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `ord_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("orderTotalCents (puro)", () => {
  it("soma preço × quantidade", () => {
    expect(orderTotalCents([{ unitPriceCents: 4000, quantity: 1 }, { unitPriceCents: 2500, quantity: 2 }])).toBe(9000);
  });
  it("comanda vazia = 0", () => {
    expect(orderTotalCents([])).toBe(0);
  });
});

describe("order.service (ciclo)", () => {
  it("abre avulsa, adiciona itens (snapshot), calcula total, fecha", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const order = await openOrder(acc, { openedById: acc, customerName: "João" });
    expect(order.status).toBe("ABERTA");

    await addItem(acc, order.id, { catalogItemId: corte.id, quantity: 1 });
    await addItem(acc, order.id, { name: "Gorjeta", unitPriceCents: 500, quantity: 1 }); // linha avulsa

    // snapshot: reajustar o catálogo NÃO muda a comanda
    await prisma.catalogItem.update({ where: { id: corte.id }, data: { priceCents: 9999 } });

    const full = await closeOrder(acc, order.id, { payment: "DINHEIRO" });
    expect(full.status).toBe("FECHADA");
    expect(full.closedAt).toBeTruthy();
    expect(full.totalCents).toBe(4500); // 4000 (snapshot) + 500
  });

  it("listOpenOrders só traz ABERTAS da própria conta", async () => {
    const acc = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    expect((await listOpenOrders(acc)).map((x) => x.id)).toContain(o.id);
    await closeOrder(acc, o.id, { payment: "PIX" });
    expect((await listOpenOrders(acc)).map((x) => x.id)).not.toContain(o.id);
  });

  it("não deixa outra conta mexer na comanda", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    await expect(addItem(other, o.id, { name: "Y", unitPriceCents: 100, quantity: 1 })).rejects.toThrow();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/order.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```ts
// src/server/services/order.service.ts
import { prisma } from "@/server/db/client";
import type { OrderPayment, OrderStatus } from "@prisma/client";

export interface OrderItemDTO { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null; }
export interface OrderDTO {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: string; closedAt: string | null;
  items: OrderItemDTO[]; totalCents: number;
}

/** Soma pura — total derivado dos itens. */
export function orderTotalCents(items: { unitPriceCents: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

function toDTO(o: {
  id: string; status: OrderStatus; leadId: string | null; customerName: string | null;
  payment: OrderPayment | null; note: string | null; createdAt: Date; closedAt: Date | null;
  items: { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number; catalogItemId: string | null }[];
}): OrderDTO {
  const items = o.items.map((i) => ({ id: i.id, nameSnapshot: i.nameSnapshot, unitPriceCents: i.unitPriceCents, quantity: i.quantity, catalogItemId: i.catalogItemId }));
  return {
    id: o.id, status: o.status, leadId: o.leadId, customerName: o.customerName,
    payment: o.payment, note: o.note, createdAt: o.createdAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null, items, totalCents: orderTotalCents(items),
  };
}

async function loadOwned(accountId: string, id: string) {
  const o = await prisma.order.findFirst({ where: { id, accountId }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (!o) throw new Error("Comanda não encontrada.");
  return o;
}

export async function openOrder(
  accountId: string,
  data: { openedById: string; leadId?: string | null; customerName?: string | null },
): Promise<OrderDTO> {
  if (!data.leadId && !data.customerName?.trim()) {
    // permitido abrir sem nada e nomear depois? Não — exige ao menos um identificador leve.
    data.customerName = "Sem nome";
  }
  const o = await prisma.order.create({
    data: {
      accountId, openedById: data.openedById,
      leadId: data.leadId ?? null,
      customerName: data.leadId ? null : (data.customerName?.trim() || "Sem nome"),
    },
    include: { items: true },
  });
  return toDTO(o);
}

export async function addItem(
  accountId: string,
  orderId: string,
  data: { catalogItemId?: string; name?: string; unitPriceCents?: number; quantity?: number },
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

  await prisma.orderItem.create({ data: { orderId, catalogItemId, nameSnapshot, unitPriceCents, quantity: qty } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function removeItem(accountId: string, orderId: string, itemId: string): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const owned = order.items.find((i) => i.id === itemId);
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.orderItem.delete({ where: { id: itemId } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function closeOrder(accountId: string, orderId: string, data: { payment: OrderPayment; note?: string }): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  await prisma.order.update({ where: { id: orderId }, data: { status: "FECHADA", payment: data.payment, note: data.note?.trim() || null, closedAt: new Date() } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function listOpenOrders(accountId: string): Promise<OrderDTO[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "ABERTA" },
    include: { items: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return orders.map(toDTO);
}

export async function getOrder(accountId: string, id: string): Promise<OrderDTO> {
  return toDTO(await loadOwned(accountId, id));
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/order.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(vendas): order.service (comanda: abrir/adicionar/fechar, total derivado + snapshot)"
```

---

## Task 2.2: API das comandas

**Files:**
- Create: `src/app/api/vendas/orders/route.ts` (GET abertas, POST abre)
- Create: `src/app/api/vendas/orders/[id]/route.ts` (GET detalhe, PATCH fecha)
- Create: `src/app/api/vendas/orders/[id]/items/route.ts` (POST adiciona)
- Create: `src/app/api/vendas/orders/[id]/items/[itemId]/route.ts` (DELETE remove)

Todas: `dynamic = "force-dynamic"`, `getTenantContext()`, 401/403, zod, `try/catch → { error }`. `openedById = ctx.sessionUserId`. Escopo `accountId = ctx.tenantUserId`.

**Step 1:** `orders/route.ts`:

```ts
// src/app/api/vendas/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listOpenOrders, openOrder } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ orders: await listOpenOrders(ctx.tenantUserId) });
}

const openSchema = z.object({ leadId: z.string().nullish(), customerName: z.string().nullish() });

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const order = await openOrder(ctx.tenantUserId, { openedById: ctx.sessionUserId, ...parsed.data });
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

**Step 2:** `orders/[id]/route.ts` (GET + PATCH fecha), `items/route.ts` (POST add), `items/[itemId]/route.ts` (DELETE) — mesmos padrões, chamando `getOrder`, `closeOrder`, `addItem`, `removeItem`. Fecha valida `payment ∈ {DINHEIRO,PIX,CARTAO,OUTRO}` via zod.

```ts
// PATCH de fechamento (orders/[id]/route.ts) — corpo:
const closeSchema = z.object({ payment: z.enum(["DINHEIRO", "PIX", "CARTAO", "OUTRO"]), note: z.string().optional() });
// ...try { closeOrder(ctx.tenantUserId, id, parsed.data) } catch → { error }
```

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/app/api/vendas/orders
git commit -m "feat(vendas): API de comandas (abrir/detalhe/adicionar/remover/fechar)"
```

---

## Task 2.3: UI — workspace de comandas

**Files:**
- Create: `src/components/vendas/OrderBoard.tsx`

Client component: coluna de comandas ABERTAS + botão "Nova comanda" (avulsa por nome OU buscar lead), painel da comanda selecionada (itens, adicionar do catálogo via busca, adicionar linha avulsa, remover, total ao vivo com `formatCentsBRL`), botão "Fechar" que pede forma de pagamento (DINHEIRO/PIX/CARTAO/OUTRO). Rodapé com **total fechado hoje** (vem de `listOpenOrders` não — usa um resumo do dia via `/api/vendas/reports?period=hoje`, ver Fase 3).

**Step 1: Componente** (esboço; após ações, re-`fetch` das abertas):

```tsx
// src/components/vendas/OrderBoard.tsx
"use client";
import { useEffect, useState } from "react";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
// estados: orders (abertas), selected, catalog (itens ativos p/ busca)
// ações: novaComanda(), addDoCatalogo(itemId), addAvulso(name, priceStr), remover(itemId), fechar(payment)
// cada ação chama a API e recarrega. Total ao vivo = selected.totalCents (o service já devolve).
```

**Step 2: Verificar** — montado na Fase 4. `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/vendas/OrderBoard.tsx
git commit -m "feat(vendas): UI do workspace de comandas"
```

---

# FASE 3 — Relatórios

## Task 3.1: Serviço de relatórios (com teste)

**Files:**
- Create: `src/server/services/sales-report.service.ts`
- Test: `src/server/services/sales-report.service.test.ts`

Agrega **comandas FECHADAS** por `closedAt` dentro de um período. Três saídas: resumo (`totalCents`, `orderCount`, `avgTicketCents`), ranking de itens mais vendidos, total por forma de pagamento. Períodos calculados no timezone `America/Sao_Paulo` (constante do projeto).

**Step 1: Teste que falha**

```ts
// src/server/services/sales-report.service.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder } from "./order.service";
import { salesSummary, topItems, revenueByPayment } from "./sales-report.service";

async function makeOwner() {
  const u = await prisma.user.create({ data: { email: `rep_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" } });
  return u.id;
}

describe("sales-report.service", () => {
  it("resumo soma só comandas fechadas e calcula ticket médio", async () => {
    const acc = await makeOwner();
    const corte = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const o1 = await openOrder(acc, { openedById: acc, customerName: "A" });
    await addItem(acc, o1.id, { catalogItemId: corte.id, quantity: 2 }); // 8000
    await closeOrder(acc, o1.id, { payment: "DINHEIRO" });
    const o2 = await openOrder(acc, { openedById: acc, customerName: "B" });
    await addItem(acc, o2.id, { catalogItemId: corte.id, quantity: 1 }); // 4000
    await closeOrder(acc, o2.id, { payment: "PIX" });
    await openOrder(acc, { openedById: acc, customerName: "C" }); // ABERTA — não conta

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const s = await salesSummary(acc, from, to);
    expect(s.totalCents).toBe(12000);
    expect(s.orderCount).toBe(2);
    expect(s.avgTicketCents).toBe(6000);

    const byPay = await revenueByPayment(acc, from, to);
    expect(byPay.find((p) => p.payment === "DINHEIRO")?.totalCents).toBe(8000);
    expect(byPay.find((p) => p.payment === "PIX")?.totalCents).toBe(4000);

    const top = await topItems(acc, from, to, 5);
    expect(top[0].name).toBe("Corte");
    expect(top[0].quantity).toBe(3);
    expect(top[0].totalCents).toBe(12000);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/sales-report.service.test.ts`
Expected: FAIL.

**Step 3: Implementar** (usa `prisma.$queryRaw` ou `groupBy`/`aggregate`; como o total é derivado de `OrderItem`, some via join às comandas fechadas no período):

```ts
// src/server/services/sales-report.service.ts
import { prisma } from "@/server/db/client";
import type { OrderPayment } from "@prisma/client";

export interface SalesSummary { totalCents: number; orderCount: number; avgTicketCents: number; }

async function closedOrderIds(accountId: string, from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function salesSummary(accountId: string, from: Date, to: Date): Promise<SalesSummary> {
  const ids = await closedOrderIds(accountId, from, to);
  if (!ids.length) return { totalCents: 0, orderCount: 0, avgTicketCents: 0 };
  const agg = await prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { unitPriceCents: true, quantity: true } });
  const totalCents = agg.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const orderCount = ids.length;
  return { totalCents, orderCount, avgTicketCents: Math.round(totalCents / orderCount) };
}

export async function revenueByPayment(accountId: string, from: Date, to: Date): Promise<{ payment: OrderPayment; totalCents: number }[]> {
  const orders = await prisma.order.findMany({
    where: { accountId, status: "FECHADA", closedAt: { gte: from, lte: to } },
    select: { payment: true, items: { select: { unitPriceCents: true, quantity: true } } },
  });
  const map = new Map<OrderPayment, number>();
  for (const o of orders) {
    if (!o.payment) continue;
    const t = o.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    map.set(o.payment, (map.get(o.payment) ?? 0) + t);
  }
  return [...map.entries()].map(([payment, totalCents]) => ({ payment, totalCents }));
}

export async function topItems(accountId: string, from: Date, to: Date, limit = 10): Promise<{ name: string; quantity: number; totalCents: number }[]> {
  const ids = await closedOrderIds(accountId, from, to);
  if (!ids.length) return [];
  const items = await prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { nameSnapshot: true, unitPriceCents: true, quantity: true } });
  const map = new Map<string, { quantity: number; totalCents: number }>();
  for (const i of items) {
    const cur = map.get(i.nameSnapshot) ?? { quantity: 0, totalCents: 0 };
    cur.quantity += i.quantity; cur.totalCents += i.unitPriceCents * i.quantity;
    map.set(i.nameSnapshot, cur);
  }
  return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.totalCents - a.totalCents).slice(0, limit);
}
```

> Nota de performance: para volume baixo (negócio pequeno) somar em memória é suficiente e simples. Se um dia crescer, trocar por `$queryRaw` com `SUM(...)` no Postgres — ver skill @supabase-postgres-best-practices.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/sales-report.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/sales-report.service.ts src/server/services/sales-report.service.test.ts
git commit -m "feat(vendas): sales-report.service (resumo, mais vendidos, por pagamento)"
```

---

## Task 3.2: API + helper de período + UI de relatórios

**Files:**
- Create: `src/server/services/date-range.ts` (períodos "hoje" / "7d" / "mes" em America/Sao_Paulo)
- Create: `src/app/api/vendas/reports/route.ts`
- Create: `src/components/vendas/ReportsPanel.tsx`

**Step 1: Helper de período** (teste rápido opcional — bordas de dia no fuso). `hoje` = início do dia local até agora; `7d` = 7 dias; `mes` = início do mês.

**Step 2: Rota** `GET /api/vendas/reports?period=hoje|7d|mes` → resolve `from/to`, chama os 3 serviços, devolve `{ summary, byPayment, topItems }`. `getTenantContext`, 401.

**Step 3: UI** `ReportsPanel.tsx` — toggle de período (Hoje/7 dias/Mês) + 3 cards (Faturamento, Nº de comandas, Ticket médio) com `formatCentsBRL`, tabela "Mais vendidos" e lista "Por forma de pagamento". Usado também pelo rodapé "hoje" do `OrderBoard`.

**Step 4: Verificar tipos + Commit**

Run: `npx tsc --noEmit`

```bash
git add src/server/services/date-range.ts src/app/api/vendas/reports src/components/vendas/ReportsPanel.tsx
git commit -m "feat(vendas): API e UI de relatórios (hoje/7d/mês)"
```

---

# FASE 4 — Página, navegação e verificação E2E

## Task 4.1: Página `/vendas` com abas

**Files:**
- Create: `src/app/(app)/vendas/page.tsx` (server: resolve `ctx`, redirect se não logado)
- Create: `src/components/vendas/VendasWorkspace.tsx` (client: abas Comandas · Catálogo · Relatórios)

**Step 1: Página server** (padrão de `configuracoes/page.tsx`):

```tsx
// src/app/(app)/vendas/page.tsx
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { VendasWorkspace } from "@/components/vendas/VendasWorkspace";

export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canSettings; // cadastrar catálogo exige canSettings; registrar comanda, não
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Vendas</h1>
        <p className="mt-1 text-sm text-slate-500">Registre as vendas do dia, gerencie seu catálogo e acompanhe o faturamento.</p>
      </header>
      <VendasWorkspace canEdit={canEdit} />
    </div>
  );
}
```

**Step 2: Workspace client** — abas simples (estado local `tab`), renderizando `OrderBoard`, `CatalogManager`, `ReportsPanel`. Comandas como aba default.

**Step 3: Commit**

```bash
git add "src/app/(app)/vendas" src/components/vendas/VendasWorkspace.tsx
git commit -m "feat(vendas): página /vendas com abas Comandas/Catálogo/Relatórios"
```

---

## Task 4.2: Item na navegação

**Files:**
- Modify: `src/components/app/Sidebar.tsx` (grupo "Gestão", ~linha 119)

**Step 1:** importe um ícone da `lucide-react` (ex.: `Receipt`) junto dos outros imports de ícone, e adicione ao grupo "Gestão", antes de "Configurações":

```tsx
        { href: "/vendas", label: "Vendas", icon: Receipt },
```

**Step 2: Verificar** — o item aparece pra todos (sem `show`, pois é de todos os planos e papéis; operador sem `canSettings` ainda registra comanda, só não cadastra catálogo).

**Step 3: Commit**

```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat(vendas): item Vendas na navegação"
```

---

## Task 4.3: Verificação end-to-end (manual)

Use a skill @verify. Run: `npm run dev`.

**Checklist:**
- [ ] `/vendas` abre nas 3 abas.
- [ ] **Catálogo:** cadastrar "Corte R$40" (serviço) e "X-Burguer R$25" (produto); editar preço; desativar/reativar; excluir.
- [ ] **Comanda avulsa:** nova comanda "João" → adicionar Corte + linha avulsa "Gorjeta R$5" → total ao vivo R$45 → fechar em DINHEIRO.
- [ ] **Comanda com lead:** nova comanda buscando um lead existente → adicionar item → fechar em PIX.
- [ ] **Snapshot:** após fechar, mude o preço do Corte no catálogo → a comanda fechada mantém o valor antigo.
- [ ] **Relatórios:** aba mostra faturamento de hoje, nº de comandas, ticket médio, "mais vendidos" e total por pagamento coerentes.
- [ ] **Operador sem `canSettings`:** consegue registrar comanda, mas o form de cadastrar catálogo fica desabilitado; POST direto em `/api/vendas/catalog` retorna 403.
- [ ] `npx vitest run` (tudo verde) e `npx tsc --noEmit` (limpo).

---

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde.
- [ ] `npx tsc --noEmit` — limpo.
- [ ] Dinheiro sempre em centavos; UI formata com `formatCentsBRL`.
- [ ] Todo dado escopado por `accountId`; nenhuma query cruza tenant.
- [ ] Sem `assertFeature` (módulo liberado em todos os planos, por decisão).

**Notas de produção (para o dono aplicar):**
- Aplicar `prisma/manual/2026-07-03-vendas.sql` no Supabase SQL Editor de **prod** ANTES de usar (a leitura NÃO degrada como o branding — comanda quebra sem tabela). Validar com `select to_regclass('public."Order"')` etc.
- Conferir se o role `crm` (usado pelo Prisma) tem acesso às tabelas novas; se criar via SQL Editor (`postgres`), rodar `GRANT SELECT, INSERT, UPDATE, DELETE ON "CatalogItem","Order","OrderItem" TO crm;` (mesma pegadinha do branding).
- Deploy pela CLL da Vercel (ver memória `vercel-hobby-push-block`).

**Fora de escopo (v2, premium sob demanda):** cobrança Pix no fechamento (reusar `Sale`); exportação CSV; gráficos; seletor de intervalo custom; **relatório por operador** (o `openedById` já é gravado — só falta a tela); reabrir comanda fechada; desconto/acréscimo na comanda.
