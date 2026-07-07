# Anúncios no Catálogo (fotos + ficha técnica + IA) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que um item do catálogo (um carro, um imóvel, um produto) tenha uma **galeria de fotos** e uma **ficha técnica estruturada (specs)**, e que a IA de atendimento **envie as fotos + a ficha** ao cliente no WhatsApp — tudo opt-in por ramo (veículos/imóveis), sem tocar na experiência dos ramos de serviço.

**Architecture:** Estendemos o `CatalogItem` já existente em vez de criar um modelo novo — assim herdamos de graça a integração com IA (`consultar_estoque`, `enviar_catalogo`), comanda/venda, estoque (INDISPONÍVEL quando vende) e caixa. Duas adições de schema: (1) uma tabela-filha `CatalogItemPhoto` (galeria; binário no Supabase Storage, só o path no banco — mesmo padrão de `MediaAsset`/`Message`), e (2) um novo `CustomFieldScope.PRODUCT` + `CatalogItem.customFields Json?` para as specs (reusando toda a maquinaria de `CustomFieldDef` / `mergeCustomFields` / `CustomFieldInput`). A IA ganha uma tool nova `enviar_fotos`. **NÃO** entra vitrine pública nesta entrega.

**Tech Stack:** Next.js App Router (route handlers + server components/client components), Prisma + Postgres (Supabase), Supabase Storage (bucket privado `whatsapp-media`), Zod, Vitest. Deploy PROD por **onda SQL manual idempotente** (`prisma/manual/AAAA-MM-DD-onda-*.sql`), **nunca** por migration versionada — ver `[[prod-schema-drift-destravar]]`.

---

## Convenções desta base (leia antes de começar)

- **Testes:** `npm test` (→ `vitest run`). Testes co-localizados: `foo.service.ts` → `foo.service.test.ts` ao lado. Sem mocks de Prisma — os testes usam **Postgres real** (`DATABASE_URL` do ambiente) e isolam criando um dono descartável por asserção:
  ```ts
  async function makeOwner() {
    const u = await prisma.user.create({
      data: { email: `x_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
    });
    return u.id;
  }
  ```
  Um único teste roda com `npx vitest run src/caminho/arquivo.test.ts -t "trecho do nome"`.
- **Multi-tenant:** toda função de service recebe `accountId` como **1º parâmetro** (nunca do body). Nas rotas vem de `ctx.tenantUserId` (via `getTenantContext()`); mutações que mexem em configuração exigem `ctx.perms.canSettings` (403 se faltar).
- **Storage:** binário nunca vai pro Postgres. Sobe via `uploadInboundMedia(buffer, {leadId, messageKey, mime, ext})` (path = `<leadId>/<messageKey>.<ext>`); para assets da conta usamos `leadId = accountId` e `messageKey = crypto.randomUUID()`. Baixa via `downloadMediaBuffer(path)`; URL assinada sob demanda via `createMediaSignedUrl(path, ttl)`; apaga via `removeMediaObjects([path])`. Helpers em `src/server/storage/media-storage.ts`.
- **Deploy PROD:** editar `prisma/schema.prisma`, rodar `npm run db:push` no dev, e criar **UMA** onda SQL idempotente. **Não** criar pasta em `prisma/migrations/` para a mesma mudança (colisão P3018→P3009 trava o deploy). Detalhe em `[[prod-schema-drift-destravar]]`.
- **Antes de `db:push`/`prisma generate` no Windows:** parar o `next dev` (senão EPERM no rename da DLL do query-engine) — ver `[[prisma-generate-dev-server-lock]]`.
- **Commits frequentes.** Um commit por task concluída (test + código juntos). Mensagem no padrão do repo: `feat(catalogo/fotos): ...`, `feat(catalogo/specs): ...`, etc. Rodapé de commit conforme instrução da sessão.

---

## Sumário das fases

| Fase | Entrega | Schema? |
|---|---|---|
| 0 | Schema Prisma + onda SQL (enum PRODUCT, `CatalogItem.customFields`, tabela `CatalogItemPhoto`) | **Sim** |
| 1 | Specs: escopo PRODUCT ponta a ponta (service + rota + custom-fields plumbing) | não |
| 2 | Fotos: `catalog-photo.service` + rotas de upload/list/delete/reorder + signed-url | não |
| 3 | UI: galeria + editor de ficha técnica no `CatalogManager` | não |
| 4 | IA: injeta specs no contexto + tool nova `enviar_fotos` | não |
| 5 | Presets por ramo (veículos/imóveis) + wizard/seed reconhecem PRODUCT | não |
| 6 | Gate verde + checklist de deploy + memória | — |

---

# FASE 0 — Schema + migração

### Task 0.1: Adicionar `PRODUCT` ao enum, `customFields` ao `CatalogItem`, e o modelo `CatalogItemPhoto`

**Files:**
- Modify: `prisma/schema.prisma` (enum `CustomFieldScope` L777-781; model `CatalogItem` L381-416; adicionar model novo)

**Step 1 — Editar o enum** (`prisma/schema.prisma`, bloco `enum CustomFieldScope`):

```prisma
enum CustomFieldScope {
  LEAD
  ORDER
  ORDER_ITEM
  PRODUCT // ficha técnica do item de catálogo (anúncio): specs de carro/imóvel/produto
}
```

**Step 2 — Adicionar `customFields` e a relação `photos` no `model CatalogItem`** (logo após `printSector`, antes do bloco de `@@`):

```prisma
  // --- Anúncio (fotos + ficha técnica); opt-in, usado por veículos/imóveis/varejo ---
  customFields Json? // valores dos CustomFieldDef scope=PRODUCT (chaveado por 'key')
  photos       CatalogItemPhoto[]
```

**Step 3 — Adicionar o model novo** (no fim do arquivo, junto dos outros models de catálogo/estoque):

```prisma
// Foto de um item de catálogo (galeria do anúncio). O binário vive no Supabase
// Storage (bucket privado, mesmo de MediaAsset/Message); aqui guardamos só o
// caminho do objeto. `order` define a ordem de exibição (0 = capa).
model CatalogItemPhoto {
  id            String      @id @default(cuid())
  catalogItem   CatalogItem @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  catalogItemId String
  mediaPath     String // caminho no bucket (NÃO é URL; assinamos sob demanda)
  mediaMime     String
  order         Int         @default(0)
  createdAt     DateTime    @default(now())

  @@index([catalogItemId, order])
}
```

**Step 4 — Aplicar no dev.** Parar o `next dev` antes (Windows lock). Rodar:

```bash
npm run db:push
```
Expected: `Your database is now in sync with your Prisma schema.` + client regenerado (novo tipo `CatalogItemPhoto`, `CatalogItem.customFields`, `CustomFieldScope.PRODUCT`).

**Step 5 — Sanidade de tipos:** rodar o build de tipos rápido (ou `npx tsc --noEmit` se existir; senão pular — o gate roda no fim). Não commitar ainda; o commit vem com a onda SQL na próxima task.

---

### Task 0.2: Onda SQL manual idempotente (PROD)

**Files:**
- Create: `prisma/manual/2026-07-13-onda-i.sql` (confirmar a próxima letra livre: listar `prisma/manual/` e usar a letra seguinte à última onda — o plano assume `i`; ajustar se já existir)

**Step 1 — Escrever o SQL idempotente:**

```sql
-- Onda I — Anúncios no catálogo (fotos + ficha técnica).
-- Idempotente. Aplicar no Supabase SQL Editor (produção) ANTES do deploy de código.
-- NÃO duplicar com migration versionada em prisma/migrations. Ver [[prod-schema-drift-destravar]].

-- 1) Novo valor no enum de escopo de campo customizado (specs do produto/anúncio).
--    ADD VALUE IF NOT EXISTS é idempotente; roda fora de transação.
ALTER TYPE "CustomFieldScope" ADD VALUE IF NOT EXISTS 'PRODUCT';

-- 2) Coluna de specs no item de catálogo (valores dos CustomFieldDef scope=PRODUCT).
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "customFields" JSONB;

-- 3) Tabela da galeria de fotos do anúncio.
CREATE TABLE IF NOT EXISTS "CatalogItemPhoto" (
  "id"            TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "mediaPath"     TEXT NOT NULL,
  "mediaMime"     TEXT NOT NULL,
  "order"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogItemPhoto_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CatalogItemPhoto"
    ADD CONSTRAINT "CatalogItemPhoto_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CatalogItemPhoto_catalogItemId_order_idx"
  ON "CatalogItemPhoto" ("catalogItemId", "order");
```

**Step 2 — Commit** (schema + onda juntos):

```bash
git add prisma/schema.prisma prisma/manual/2026-07-13-onda-i.sql
git commit -m "feat(catalogo): schema de anúncio (fotos + specs PRODUCT) + onda-i SQL"
```

> **Nota de deploy (não bloqueia o dev):** a onda-i precisa ser aplicada no Supabase **antes** do deploy do código. Registrada no checklist da Fase 6.

---

# FASE 1 — Ficha técnica (specs, escopo PRODUCT)

O escopo `PRODUCT` reusa **toda** a plumbing de custom fields. `mergeCustomFields(userId, current, patch, scope)` já funciona para qualquer escopo (carrega os defs daquele escopo). Só precisamos: (a) liberar `PRODUCT` nos schemas Zod das rotas de defs; (b) uma função de service para gravar `CatalogItem.customFields`; (c) a rota que a chama.

### Task 1.1: Liberar `PRODUCT` no CRUD de `CustomFieldDef`

**Files:**
- Modify: `src/app/api/custom-fields/route.ts` (o `scopeSchema`)
- Test: `src/app/api/custom-fields/route.test.ts` **se existir**; senão cobrir via service na Task 1.2 (não criar teste de rota novo do zero aqui)

**Step 1 — Achar e ampliar o `scopeSchema`** em `src/app/api/custom-fields/route.ts`:

Trocar:
```ts
const scopeSchema = z.enum(["LEAD", "ORDER", "ORDER_ITEM"]).catch("LEAD");
```
por:
```ts
const scopeSchema = z.enum(["LEAD", "ORDER", "ORDER_ITEM", "PRODUCT"]).catch("LEAD");
```
E no `createSchema` do POST, o campo `scope` (que usa `.default("LEAD")`) — garantir que aceita `PRODUCT` (se ele referencia `scopeSchema`/mesmo enum, já está; se tiver um enum inline, ampliar igual).

**Step 2 — Verificar o service `createDef`** em `src/server/services/custom-field.service.ts`: o parâmetro `scope` é tipado como `CustomFieldScope` do Prisma — após `db:push`/generate já inclui `PRODUCT`. Nenhuma mudança de código necessária (confirmar lendo a assinatura).

**Step 3 — Commit:**
```bash
git add src/app/api/custom-fields/route.ts
git commit -m "feat(custom-fields): aceita escopo PRODUCT no CRUD de definições"
```

---

### Task 1.2: `setCatalogItemCustomFields` no catalog.service

**Files:**
- Modify: `src/server/services/catalog.service.ts`
- Test: `src/server/services/catalog.service.test.ts`

**Step 1 — Escrever o teste que falha** (adicionar ao final de `catalog.service.test.ts`):

```ts
import { createDef } from "@/server/services/custom-field.service";
import { setCatalogItemCustomFields } from "@/server/services/catalog.service";

it("grava specs (PRODUCT) no item e valida chave desconhecida", async () => {
  const a = await makeOwner();
  await createDef(a, { label: "Ano", type: "NUMBER", scope: "PRODUCT" });
  await createDef(a, { label: "Cor", type: "TEXT", scope: "PRODUCT" });
  const item = await createCatalogItem(a, { name: "Onix 2019", priceCents: 5490000, kind: "PRODUTO" });

  const upd = await setCatalogItemCustomFields(a, item.id, { ano: 2019, cor: "Prata" });
  expect(upd.customFields).toEqual({ ano: 2019, cor: "Prata" });

  // chave desconhecida (não existe def PRODUCT com essa key) → erro
  await expect(
    setCatalogItemCustomFields(a, item.id, { placa: "ABC1D23" }),
  ).rejects.toThrow();
});

it("não deixa gravar specs em item de outra conta", async () => {
  const a = await makeOwner();
  const b = await makeOwner();
  await createDef(a, { label: "Ano", type: "NUMBER", scope: "PRODUCT" });
  const item = await createCatalogItem(a, { name: "Carro", priceCents: 100, kind: "PRODUTO" });
  await expect(setCatalogItemCustomFields(b, item.id, { ano: 2020 })).rejects.toThrow();
});
```
> Nota: `slugifyKey("Ano") === "ano"`, `slugifyKey("Cor") === "cor"` (o service de custom-field normaliza label → key). Por isso o patch usa `ano`/`cor`.

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/services/catalog.service.test.ts -t "specs"
```
Expected: FAIL (`setCatalogItemCustomFields is not a function`).

**Step 3 — Implementar** em `src/server/services/catalog.service.ts`. Adicionar o import no topo e a função (espelha `setOrderCustomFields` de `order.service.ts`, mas sem guard de status — item de catálogo não tem ciclo ABERTA/FECHADA):

```ts
import { mergeCustomFields } from "@/server/services/custom-field.service";
import type { Prisma } from "@prisma/client";

// Grava a ficha técnica (specs) do item — valores dos CustomFieldDef scope=PRODUCT.
// Valida posse, mescla/coage via mergeCustomFields (chave desconhecida → erro;
// valor vazio → remove a chave). Retorna o DTO atualizado.
export async function setCatalogItemCustomFields(
  accountId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<CatalogItemDTO> {
  const owned = await prisma.catalogItem.findFirst({
    where: { id, accountId },
    select: { id: true, customFields: true },
  });
  if (!owned) throw new Error("Item não encontrado.");
  const merged = await mergeCustomFields(
    accountId,
    (owned.customFields as Record<string, unknown> | null) ?? null,
    patch,
    "PRODUCT",
  );
  const row = await prisma.catalogItem.update({
    where: { id },
    data: { customFields: merged as Prisma.InputJsonValue },
  });
  return toDTO(row);
}
```

**Step 4 — Expor `customFields` no DTO.** No `interface CatalogItemDTO` (L7-22) adicionar:
```ts
  customFields: Record<string, unknown> | null;
```
E no `toDTO` (função que mapeia row→DTO) adicionar:
```ts
  customFields: (row.customFields as Record<string, unknown> | null) ?? null,
```

**Step 5 — Rodar e ver passar:**
```bash
npx vitest run src/server/services/catalog.service.test.ts
```
Expected: PASS (todos, incluindo os antigos).

**Step 6 — Commit:**
```bash
git add src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(catalogo/specs): setCatalogItemCustomFields (escopo PRODUCT) + DTO"
```

---

### Task 1.3: Rota `PATCH /api/vendas/catalog/[id]/fields`

**Files:**
- Create: `src/app/api/vendas/catalog/[id]/fields/route.ts`
- (Referência: `src/app/api/vendas/orders/[id]/fields/route.ts` — copiar o formato)

**Step 1 — Escrever a rota** (espelha a de orders/fields):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { setCatalogItemCustomFields } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

const schema = z.object({ customFields: z.record(z.string(), z.unknown()) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Inválido" }, { status: 400 });
  }
  try {
    const item = await setCatalogItemCustomFields(ctx.tenantUserId, id, parsed.data.customFields);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

**Step 2 — Smoke manual (opcional).** Se houver server rodando, verificar via cookie cunhado (ver `[[verify-via-minted-session]]`). Caso contrário confiar no teste de service da Task 1.2.

**Step 3 — Commit:**
```bash
git add "src/app/api/vendas/catalog/[id]/fields/route.ts"
git commit -m "feat(catalogo/specs): rota PATCH .../catalog/[id]/fields"
```

---

# FASE 2 — Galeria de fotos

### Task 2.1: `catalog-photo.service.ts`

**Files:**
- Create: `src/server/services/catalog-photo.service.ts`
- Test: `src/server/services/catalog-photo.service.test.ts`
- (Referência de padrão: `src/server/services/media-asset.service.ts`)

**Step 1 — Escrever o teste que falha.** Importante: `uploadInboundMedia`/`removeMediaObjects` retornam `null`/`false` quando o Storage **não** está configurado (dev sem Supabase). Para o teste ser determinístico sem Storage, **mockamos** o módulo de storage com `vi.mock` (padrão de teste de unidade; os testes de service que tocam Storage seguem esta linha).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";

vi.mock("@/server/storage/media-storage", () => ({
  uploadInboundMedia: vi.fn(async () => "acct/uuid-1.jpg"),
  removeMediaObjects: vi.fn(async () => true),
  downloadMediaBuffer: vi.fn(async () => Buffer.from("x")),
  createMediaSignedUrl: vi.fn(async () => "https://signed.example/x"),
}));

import {
  addCatalogItemPhoto,
  listCatalogItemPhotos,
  deleteCatalogItemPhoto,
  reorderCatalogItemPhotos,
} from "@/server/services/catalog-photo.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cph_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}
async function makeItem(accountId: string) {
  const it = await prisma.catalogItem.create({
    data: { accountId, name: "Carro", priceCents: 100, kind: "PRODUTO" },
  });
  return it.id;
}

describe("catalog-photo.service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adiciona foto e lista em ordem", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    const p1 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "image/jpeg" });
    const p2 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("b"), mime: "image/png" });
    expect(p1.order).toBe(0);
    expect(p2.order).toBe(1);
    const list = await listCatalogItemPhotos(a, item);
    expect(list.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it("rejeita mime não-imagem", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    await expect(
      addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "application/pdf" }),
    ).rejects.toThrow();
  });

  it("não adiciona foto em item de outra conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const item = await makeItem(a);
    await expect(
      addCatalogItemPhoto(b, item, { buffer: Buffer.from("a"), mime: "image/jpeg" }),
    ).rejects.toThrow();
  });

  it("deleta foto (apaga do storage) e reordena", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    const p1 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "image/jpeg" });
    const p2 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("b"), mime: "image/jpeg" });
    await deleteCatalogItemPhoto(a, item, p1.id);
    await reorderCatalogItemPhotos(a, item, [p2.id]);
    const list = await listCatalogItemPhotos(a, item);
    expect(list.map((p) => p.id)).toEqual([p2.id]);
    expect(list[0].order).toBe(0);
  });
});
```

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/services/catalog-photo.service.test.ts
```
Expected: FAIL (módulo não existe).

**Step 3 — Implementar** `src/server/services/catalog-photo.service.ts`:

```ts
import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import {
  uploadInboundMedia,
  removeMediaObjects,
} from "@/server/storage/media-storage";

export interface CatalogItemPhotoDTO {
  id: string;
  mediaPath: string;
  mediaMime: string;
  order: number;
}

const IMG_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function toDTO(row: { id: string; mediaPath: string; mediaMime: string; order: number }): CatalogItemPhotoDTO {
  return { id: row.id, mediaPath: row.mediaPath, mediaMime: row.mediaMime, order: row.order };
}

// Garante que o item pertence à conta; retorna o id ou lança.
async function assertOwnedItem(accountId: string, itemId: string): Promise<void> {
  const owned = await prisma.catalogItem.findFirst({
    where: { id: itemId, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Item não encontrado.");
}

export async function listCatalogItemPhotos(accountId: string, itemId: string): Promise<CatalogItemPhotoDTO[]> {
  await assertOwnedItem(accountId, itemId);
  const rows = await prisma.catalogItemPhoto.findMany({
    where: { catalogItemId: itemId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

export async function addCatalogItemPhoto(
  accountId: string,
  itemId: string,
  data: { buffer: Buffer; mime: string },
): Promise<CatalogItemPhotoDTO> {
  await assertOwnedItem(accountId, itemId);
  const ext = IMG_EXT[data.mime.toLowerCase()];
  if (!ext) throw new Error("Envie uma imagem (JPEG, PNG, WebP ou GIF).");

  const mediaPath = await uploadInboundMedia(data.buffer, {
    leadId: accountId, // assets da conta ficam em <accountId>/<uuid>.<ext>
    messageKey: crypto.randomUUID(),
    mime: data.mime,
    ext,
  });
  if (!mediaPath) throw new Error("Storage de mídia não configurado ou upload falhou.");

  const count = await prisma.catalogItemPhoto.count({ where: { catalogItemId: itemId } });
  const row = await prisma.catalogItemPhoto.create({
    data: { catalogItemId: itemId, mediaPath, mediaMime: data.mime, order: count },
  });
  return toDTO(row);
}

export async function deleteCatalogItemPhoto(accountId: string, itemId: string, photoId: string): Promise<void> {
  await assertOwnedItem(accountId, itemId);
  const photo = await prisma.catalogItemPhoto.findFirst({
    where: { id: photoId, catalogItemId: itemId },
    select: { id: true, mediaPath: true },
  });
  if (!photo) throw new Error("Foto não encontrada.");
  await removeMediaObjects([photo.mediaPath]); // best-effort
  await prisma.catalogItemPhoto.delete({ where: { id: photo.id } });
}

// Reordena por índice do array (0..n-1); ignora ids que não pertencem ao item.
export async function reorderCatalogItemPhotos(accountId: string, itemId: string, orderedIds: string[]): Promise<void> {
  await assertOwnedItem(accountId, itemId);
  const owned = await prisma.catalogItemPhoto.findMany({
    where: { catalogItemId: itemId },
    select: { id: true },
  });
  const valid = new Set(owned.map((p) => p.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, idx) => prisma.catalogItemPhoto.update({ where: { id }, data: { order: idx } })),
  );
}
```

**Step 4 — Rodar e ver passar:**
```bash
npx vitest run src/server/services/catalog-photo.service.test.ts
```
Expected: PASS.

**Step 5 — Commit:**
```bash
git add src/server/services/catalog-photo.service.ts src/server/services/catalog-photo.service.test.ts
git commit -m "feat(catalogo/fotos): catalog-photo.service (add/list/delete/reorder)"
```

---

### Task 2.2: Rotas de fotos (upload / list / delete / reorder)

**Files:**
- Create: `src/app/api/vendas/catalog/[id]/photos/route.ts` (GET lista, POST upload multipart)
- Create: `src/app/api/vendas/catalog/[id]/photos/[photoId]/route.ts` (DELETE)
- Create: `src/app/api/vendas/catalog/[id]/photos/reorder/route.ts` (PATCH)
- (Referência: `src/app/api/media-assets/route.ts` para o parsing multipart + limites)

**Step 1 — `photos/route.ts`** (GET + POST):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import {
  addCatalogItemPhoto,
  listCatalogItemPhotos,
} from "@/server/services/catalog-photo.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024 * 1024;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const photos = await listCatalogItemPhotos(ctx.tenantUserId, id);
    return NextResponse.json({ photos });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 16MB" }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "Envie uma imagem" }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const photo = await addCatalogItemPhoto(ctx.tenantUserId, id, { buffer, mime });
    return NextResponse.json({ photo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro";
    const status = /Storage/i.test(msg) ? 503 : /não encontrado/i.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
```

**Step 2 — `photos/[photoId]/route.ts`** (DELETE):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { deleteCatalogItemPhoto } from "@/server/services/catalog-photo.service";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id, photoId } = await params;
  try {
    await deleteCatalogItemPhoto(ctx.tenantUserId, id, photoId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}
```

**Step 3 — `photos/reorder/route.ts`** (PATCH):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { reorderCatalogItemPhotos } from "@/server/services/catalog-photo.service";

export const dynamic = "force-dynamic";

const schema = z.object({ orderedIds: z.array(z.string()) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Inválido" }, { status: 400 });
  try {
    await reorderCatalogItemPhotos(ctx.tenantUserId, id, parsed.data.orderedIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}
```

**Step 4 — Commit:**
```bash
git add "src/app/api/vendas/catalog/[id]/photos"
git commit -m "feat(catalogo/fotos): rotas de upload/list/delete/reorder de fotos"
```

---

### Task 2.3: Endpoint de URL assinada para fotos do catálogo

Fotos ficam em bucket **privado**. O front não pode usar o path direto — precisa de um endpoint que assine sob demanda (mesmo padrão de `GET /api/media/[messageId]`). Este endpoint precisa ser **autenticado** (só a conta dona vê suas fotos) — a vitrine pública não entra nesta entrega.

**Files:**
- Create: `src/app/api/catalog-photo/[photoId]/route.ts`
- Test: `src/app/api/catalog-photo/[photoId]/route.test.ts` (opcional; a lógica de autorização é simples — cobrir se houver padrão de teste de rota no repo; senão pular)
- (Referência: `src/app/api/media/[messageId]/route.ts`)

**Step 1 — Escrever a rota:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { createMediaSignedUrl } from "@/server/storage/media-storage";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { photoId } = await params;
  const photo = await prisma.catalogItemPhoto.findUnique({
    where: { id: photoId },
    select: { mediaPath: true, catalogItem: { select: { accountId: true } } },
  });
  if (!photo || photo.catalogItem.accountId !== ctx.tenantUserId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  const url = await createMediaSignedUrl(photo.mediaPath, 300);
  if (!url) return NextResponse.json({ error: "Storage de mídia indisponível" }, { status: 503 });
  return NextResponse.redirect(url, 302);
}
```

**Step 2 — Commit:**
```bash
git add "src/app/api/catalog-photo/[photoId]/route.ts"
git commit -m "feat(catalogo/fotos): endpoint de URL assinada (/api/catalog-photo/[photoId])"
```

---

# FASE 3 — UI (galeria + ficha técnica no CatalogManager)

O catálogo é gerido por `src/components/vendas/CatalogManager.tsx` (client, usa `fetch` + API routes; edição inline por linha). Adicionamos, **na linha em edição de um item `PRODUTO`**, dois blocos: (a) **Fotos** e (b) **Ficha técnica** (reusa `OrderCustomFields`/`CustomFieldInput` com `scope=PRODUCT`).

### Task 3.1: Componente `CatalogItemPhotos` (galeria de um item)

**Files:**
- Create: `src/components/vendas/CatalogItemPhotos.tsx`

**Step 1 — Escrever o componente** (client; carrega fotos ao expandir, faz upload, remove; thumbnails via `/api/catalog-photo/{id}`):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Upload, ImageIcon } from "lucide-react";

interface Photo {
  id: string;
  order: number;
}

export default function CatalogItemPhotos({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/vendas/catalog/${itemId}/photos`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPhotos(data.photos ?? []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/vendas/catalog/${itemId}/photos`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Falha ao subir a foto");
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/vendas/catalog/${itemId}/photos/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-700">
        <ImageIcon size={14} /> Fotos do anúncio
      </div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded border border-slate-200">
            {/* bucket privado → URL assinada sob demanda pelo endpoint */}
            <img src={`/api/catalog-photo/${p.id}`} alt="" className="h-full w-full object-cover" />
            {canEdit && (
              <button
                type="button"
                onClick={() => void remove(p.id)}
                className="absolute right-0 top-0 bg-black/60 p-1 text-white"
                aria-label="Remover foto"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
        {photos.length === 0 && <span className="text-sm text-ink-400">Nenhuma foto ainda.</span>}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="text-sm" />
          <button
            type="button"
            onClick={() => void upload()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded bg-forest px-2 py-1 text-sm text-white disabled:opacity-50"
          >
            <Upload size={12} /> {uploading ? "Enviando…" : "Adicionar"}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```
> **Nota de estilo:** usar tokens/cores da base (`text-ink-*`, `bg-forest`, `border-slate-*`) — **nunca** hex fixo; ver `[[design-tokens-dark-theme]]`. Conferir num relance como outras linhas do `CatalogManager` estilizam botões e copiar as classes de lá para consistência.

**Step 2 — Commit:**
```bash
git add src/components/vendas/CatalogItemPhotos.tsx
git commit -m "feat(catalogo/ui): galeria de fotos do item (CatalogItemPhotos)"
```

---

### Task 3.2: Componente `CatalogItemSpecs` (ficha técnica de um item)

Reusa `OrderCustomFields` (que já recebe `defs`, `values`, `onSave`) — mas ele foi feito para comanda/item. Mais simples e DRY: criar um wrapper fino que busca os defs `PRODUCT` uma vez e renderiza `CustomFieldInput` por campo, salvando via a rota da Task 1.3.

**Files:**
- Create: `src/components/vendas/CatalogItemSpecs.tsx`
- (Referência: `src/components/vendas/OrderCustomFields.tsx` + `src/components/CustomFieldInput.tsx`)

**Step 1 — Escrever o componente:**

```tsx
"use client";

import { useEffect, useState } from "react";
import CustomFieldInput from "@/components/CustomFieldInput";

interface FieldDef {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
  options?: string[] | null;
}

export default function CatalogItemSpecs({
  itemId,
  initialValues,
  canEdit,
}: {
  itemId: string;
  initialValues: Record<string, unknown> | null;
  canEdit: boolean;
}) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>(initialValues ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/custom-fields?scope=PRODUCT", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDefs(d.items ?? d.defs ?? []))
      .catch(() => setDefs([]));
  }, []);

  if (defs.length === 0) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendas/catalog/${itemId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-ink-700">Ficha técnica</div>
      <div className="grid grid-cols-2 gap-2">
        {defs.map((d) => (
          <CustomFieldInput
            key={d.key}
            def={d}
            value={draft[d.key]}
            onChange={(v) => setDraft((prev) => ({ ...prev, [d.key]: v }))}
            disabled={!canEdit}
          />
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-forest px-2 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar ficha"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```
> **Confirmar contratos ao implementar:** (a) a rota `GET /api/custom-fields` retorna a lista sob qual chave? (`items` ou `defs`) — ajustar o `.then`. (b) A prop do `CustomFieldInput` é `def`/`value`/`onChange` e ele aceita `disabled`? Ler o componente e alinhar; se não aceitar `disabled`, condicionar a renderização a `canEdit` de outra forma.

**Step 2 — Commit:**
```bash
git add src/components/vendas/CatalogItemSpecs.tsx
git commit -m "feat(catalogo/ui): ficha técnica do item (CatalogItemSpecs, scope PRODUCT)"
```

---

### Task 3.3: Encaixar galeria + ficha na linha de edição do `CatalogManager`

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx`

**Step 1 — Importar** no topo:
```tsx
import CatalogItemPhotos from "@/components/vendas/CatalogItemPhotos";
import CatalogItemSpecs from "@/components/vendas/CatalogItemSpecs";
```

**Step 2 — Garantir que o tipo local `Item` inclui `customFields`.** No `interface Item` (L11-26), adicionar:
```tsx
  customFields?: Record<string, unknown> | null;
```

**Step 3 — Renderizar os blocos** dentro da linha em modo de edição, **apenas para `kind === "PRODUTO"`** (o anúncio só faz sentido em produto). Localizar o bloco de edição inline (aprox. L373-493) e, logo abaixo dos campos de estoque, adicionar:

```tsx
{editKind === "PRODUTO" && (
  <div className="col-span-full mt-2 space-y-3 border-t border-slate-200 pt-2">
    <CatalogItemPhotos itemId={it.id} canEdit={canEdit} />
    <CatalogItemSpecs itemId={it.id} initialValues={it.customFields ?? null} canEdit={canEdit} />
  </div>
)}
```
> Ajustar `editKind`/`it` aos nomes reais das variáveis do componente (ler o trecho de edição). Se a UI de edição não for baseada em grid com `col-span-full`, adaptar o container ao layout existente da linha.

**Step 4 — Verificar visualmente.** Rodar o app (`npm run dev`), abrir `/catalogo`, criar um item `PRODUTO`, entrar em edição: devem aparecer os blocos de Fotos e Ficha técnica. Sem Storage local, o upload retorna 503 (esperado — ver `[[local-dev-db-docker]]`); a ficha técnica funciona local. Usar a skill `/run` se precisar de apoio para subir o app.

**Step 5 — Commit:**
```bash
git add src/components/vendas/CatalogManager.tsx
git commit -m "feat(catalogo/ui): fotos + ficha técnica na edição do item (PRODUTO)"
```

---

# FASE 4 — IA envia fotos + ficha

Dois pedaços: (a) a IA precisa **saber** as specs (injetar no output da tool `consultar_estoque`, que já expõe id/estoque); (b) uma tool nova **`enviar_fotos`** que manda as fotos (+ficha como legenda da 1ª).

> **Decisão de custo de token:** as specs entram no caminho **ativo** (`consultar_estoque`, sob demanda) e na legenda de `enviar_fotos`, **não** no bloco passivo `renderCatalogForAI` (que vai em todo prompt). Assim o custo por mensagem não cresce com o tamanho da ficha. Consistente com `[[ai-context-and-media-policy]]`.

### Task 4.1: Incluir specs no output de `consultar_estoque`

**Files:**
- Modify: `src/server/ai/attendance-context.ts` (função `renderCatalogForTools`, ~L99-110)
- Modify: `src/server/ai/tools/attendance-tools.ts` (a tool `consultarEstoque`, ~L61-95, para passar os customFields)
- Test: `src/server/ai/attendance-context.test.ts` **se existir**; senão criar teste focado da função de render

**Step 1 — Teste** (render de um item com specs). Se `attendance-context.test.ts` existe, adicionar; senão criar:

```ts
import { describe, it, expect } from "vitest";
import { renderCatalogForTools } from "@/server/ai/attendance-context";

describe("renderCatalogForTools + specs", () => {
  it("inclui a ficha técnica quando presente", () => {
    const out = renderCatalogForTools([
      {
        id: "abc",
        name: "Onix 2019",
        kind: "PRODUTO",
        priceCents: 5490000,
        trackStock: true,
        stockQty: 1,
        customFields: { ano: 2019, cor: "Prata" },
      } as any,
    ]);
    expect(out).toContain("Onix 2019");
    expect(out).toContain("ano: 2019");
    expect(out).toContain("cor: Prata");
  });
});
```

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/ai/attendance-context.test.ts -t "ficha"
```
Expected: FAIL.

**Step 3 — Implementar.** Em `renderCatalogForTools`, para cada item, se `item.customFields` tiver chaves, anexar `" | ficha: k1: v1, k2: v2"`. Exemplo de trecho a adicionar dentro do `.map`:

```ts
const specs = item.customFields && typeof item.customFields === "object"
  ? Object.entries(item.customFields as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
  : "";
// ...anexar ` | ficha: ${specs}` à linha do item quando specs.length > 0
```
Garantir que `listCatalogItems` (usado por `consultarEstoque`) retorna `customFields` — já incluímos no DTO (Task 1.2 Step 4). Confirmar que a tool passa o DTO completo ao render.

**Step 4 — Rodar e ver passar:**
```bash
npx vitest run src/server/ai/attendance-context.test.ts
```
Expected: PASS.

**Step 5 — Commit:**
```bash
git add src/server/ai/attendance-context.ts src/server/ai/attendance-context.test.ts src/server/ai/tools/attendance-tools.ts
git commit -m "feat(ia/catalogo): consultar_estoque expõe a ficha técnica (specs)"
```

---

### Task 4.2: Tool `enviar_fotos`

**Files:**
- Modify: `src/server/ai/tools/attendance-tools.ts` (nova função `enviarFotos` + registro em `buildAttendanceTools` + flag no `AttendanceToolCtx`)
- Modify: `src/server/services/conversation.service.ts` (computar e passar a flag `hasProductPhotos`)
- Test: `src/server/ai/tools/attendance-tools.test.ts` (arquivo já existe — adicionar caso)

**Step 1 — Teste** (a tool baixa as fotos e chama `sendWhatsAppMedia` uma vez por foto). Seguir o estilo do `attendance-tools.test.ts` existente (ver como ele mocka `sendWhatsAppMedia`/storage e monta o `ctx`). Esqueleto:

```ts
it("enviar_fotos manda cada foto do item com a ficha na legenda da primeira", async () => {
  // arrange: criar item PRODUTO com 2 fotos (via prisma) + specs; mockar
  // downloadMediaBuffer → Buffer e sendWhatsAppMedia → spy.
  // act: achar a tool 'enviar_fotos' em buildAttendanceTools({..., hasProductPhotos:true})
  //      e chamar handler({ itemId })
  // assert: sendWhatsAppMedia chamado 2x; 1ª chamada tem caption com "ano"/"cor".
});
```
> Ler primeiro `attendance-tools.test.ts` para reusar os helpers/mocks já montados lá (não reinventar o setup do `ctx`).

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/ai/tools/attendance-tools.test.ts -t "enviar_fotos"
```
Expected: FAIL.

**Step 3 — Implementar a tool** em `attendance-tools.ts` (espelha `enviarMidia`, L266-297, mas itera fotos do item):

```ts
function enviarFotos(ctx: AttendanceToolCtx): ToolDef {
  return {
    name: "enviar_fotos",
    description:
      "Envia ao cliente as FOTOS de um item do catálogo (carro, imóvel, produto), com a ficha " +
      "técnica na legenda. Use o id do item (de consultar_estoque). Só envie quando o cliente " +
      "pedir fotos/mais detalhes de um item específico.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { itemId: { type: "string", description: "id do item (de consultar_estoque)." } },
      required: ["itemId"],
    },
    handler: async (args): Promise<ToolResult> => {
      const itemId = typeof (args as any)?.itemId === "string" ? (args as any).itemId : "";
      if (!itemId) return { content: "Nenhum item informado." };
      const photos = await listCatalogItemPhotos(ctx.accountId, itemId);
      if (photos.length === 0) return { content: "Esse item não tem fotos cadastradas." };

      // legenda = ficha técnica do item (se houver)
      const item = await prisma.catalogItem.findFirst({
        where: { id: itemId, accountId: ctx.accountId },
        select: { name: true, customFields: true },
      });
      const specs = item?.customFields && typeof item.customFields === "object"
        ? Object.entries(item.customFields as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "";
      const caption = [item?.name, specs].filter(Boolean).join("\n");

      let sent = 0;
      for (let i = 0; i < photos.length; i++) {
        const buffer = await downloadMediaBuffer(photos[i].mediaPath);
        if (!buffer) continue;
        await sendWhatsAppMedia(ctx.lead, {
          mediaPath: photos[i].mediaPath,
          mediaType: "image",
          mediaMime: photos[i].mediaMime,
          fileName: null,
          buffer,
        }, i === 0 && caption ? { caption } : undefined);
        sent++;
      }
      return { content: sent > 0 ? `enviei ${sent} foto(s)` : "não consegui carregar as fotos" };
    },
  };
}
```
Adicionar imports no topo do arquivo: `listCatalogItemPhotos` de `@/server/services/catalog-photo.service`, `downloadMediaBuffer` de `@/server/storage/media-storage`, `prisma` de `@/server/db/client` (se ainda não importado). Confirmar a assinatura de `sendWhatsAppMedia` (3º arg = opts com `caption`).

**Step 4 — Adicionar a flag no `AttendanceToolCtx`** (interface ~L18-37):
```ts
  hasProductPhotos: boolean; // conta tem ao menos uma CatalogItemPhoto → habilita enviar_fotos
```

**Step 5 — Registrar** em `buildAttendanceTools` (~L376-385):
```ts
  if (ctx.hasProductPhotos) tools.push(enviarFotos(ctx));
```

**Step 6 — Computar a flag** em `conversation.service.ts` (perto de onde `hasMedia`/`hasCatalog` são calculados, ~L683-708):
```ts
const productPhotoCount = await prisma.catalogItemPhoto.count({
  where: { catalogItem: { accountId: lead.userId } },
});
// ...
const tools = buildAttendanceTools({
  // ...campos existentes...
  hasProductPhotos: productPhotoCount > 0,
});
```

**Step 7 — Corrigir os outros pontos que constroem `AttendanceToolCtx`.** O TypeScript vai apontar qualquer teste/uso que monta o ctx sem `hasProductPhotos` — adicionar `hasProductPhotos: false` neles.

**Step 8 — Rodar e ver passar:**
```bash
npx vitest run src/server/ai/tools/attendance-tools.test.ts
```
Expected: PASS.

**Step 9 — Commit:**
```bash
git add src/server/ai/tools/attendance-tools.ts src/server/services/conversation.service.ts src/server/ai/tools/attendance-tools.test.ts
git commit -m "feat(ia/catalogo): tool enviar_fotos (galeria + ficha na legenda)"
```

---

# FASE 5 — Presets por ramo + wizard/seed

### Task 5.1: Presets PRODUCT para veículos e imóveis

O tipo `customFieldsPreset` hoje aceita `scope: "ORDER" | "ORDER_ITEM"`. Ampliar para `PRODUCT` e **adicionar** (não substituir) campos de ficha nos ramos-alvo. **Não** remover os campos `ORDER_ITEM` existentes (dados/uso atuais dependem deles).

**Files:**
- Modify: `src/lib/business-templates.ts` (interface `customFieldsPreset` L64-72; presets `revenda-veiculos` L633-666 e `imobiliaria` L1844-1872; opcional `locadora-veiculos`, `corretor-imoveis`)
- Test: `src/lib/business-templates.test.ts` (já existe — adicionar asserção)

**Step 1 — Ampliar o tipo** na interface `BusinessTemplate`:
```ts
  customFieldsPreset?: {
    scope: "ORDER" | "ORDER_ITEM" | "PRODUCT";
    label: string;
    type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
    options?: string[];
  }[];
```

**Step 2 — `revenda-veiculos`:** adicionar ao array `customFieldsPreset` os campos de ficha (scope PRODUCT):
```ts
    { scope: "PRODUCT", label: "Marca", type: "TEXT" },
    { scope: "PRODUCT", label: "Modelo", type: "TEXT" },
    { scope: "PRODUCT", label: "Ano", type: "NUMBER" },
    { scope: "PRODUCT", label: "KM", type: "NUMBER" },
    { scope: "PRODUCT", label: "Cor", type: "TEXT" },
    { scope: "PRODUCT", label: "Câmbio", type: "SELECT", options: ["Manual", "Automático"] },
    { scope: "PRODUCT", label: "Combustível", type: "SELECT", options: ["Flex", "Gasolina", "Diesel", "Elétrico", "Híbrido"] },
```

**Step 3 — `imobiliaria`:** adicionar:
```ts
    { scope: "PRODUCT", label: "Tipo", type: "SELECT", options: ["Casa", "Apartamento", "Terreno", "Comercial"] },
    { scope: "PRODUCT", label: "Quartos", type: "NUMBER" },
    { scope: "PRODUCT", label: "Banheiros", type: "NUMBER" },
    { scope: "PRODUCT", label: "Área (m²)", type: "NUMBER" },
    { scope: "PRODUCT", label: "Vagas", type: "NUMBER" },
    { scope: "PRODUCT", label: "Cidade/Bairro", type: "TEXT" },
```
(Opcional, mesma ideia: `locadora-veiculos`, `corretor-imoveis`.)

**Step 4 — Teste** (garante que os ramos-alvo têm specs PRODUCT). Em `business-templates.test.ts`:
```ts
it("revenda-veiculos e imobiliaria têm ficha técnica (PRODUCT)", () => {
  for (const id of ["revenda-veiculos", "imobiliaria"]) {
    const tpl = BUSINESS_TEMPLATES.find((t) => t.id === id)!;
    const prod = (tpl.customFieldsPreset ?? []).filter((f) => f.scope === "PRODUCT");
    expect(prod.length).toBeGreaterThan(0);
  }
});
```

**Step 5 — Rodar:**
```bash
npx vitest run src/lib/business-templates.test.ts
```
Expected: PASS.

**Step 6 — Commit:**
```bash
git add src/lib/business-templates.ts src/lib/business-templates.test.ts
git commit -m "feat(verticais): ficha técnica PRODUCT em revenda-veiculos e imobiliaria"
```

---

### Task 5.2: Seed de presets reconhece escopo PRODUCT

`seedCustomFieldPreset` (`src/server/services/custom-field-preset.service.ts` L11-43) já itera `tpl.customFieldsPreset` e cria os defs por escopo — como agora aceitamos `PRODUCT`, precisa apenas garantir que **não filtra** por escopo e que `createDef` recebe `scope: "PRODUCT"`.

**Files:**
- Modify (se necessário): `src/server/services/custom-field-preset.service.ts`
- Test: `src/server/services/custom-field-preset.service.test.ts` (se existir) ou `vertical-onboarding.service.test.ts`

**Step 1 — Ler** `custom-field-preset.service.ts` e confirmar: (a) itera todos os presets sem `filter(scope !== ...)`; (b) passa `scope: preset.scope` ao `createDef`; (c) a idempotência por `slugifyKey` considera o **escopo** (chave única é `[userId, scope, key]`). Se o pré-carregamento de keys existentes não separar por escopo, ajustar para chavear por `${scope}:${key}` — senão um label igual em escopos diferentes seria pulado indevidamente.

**Step 2 — Teste** (aplicar o preset de `revenda-veiculos` cria defs PRODUCT):
```ts
it("seedCustomFieldPreset cria defs de escopo PRODUCT", async () => {
  const a = await makeOwner();
  await seedCustomFieldPreset(a, "revenda-veiculos");
  const defs = await listDefs(a, "PRODUCT");
  expect(defs.some((d) => d.key === "marca")).toBe(true);
});
```

**Step 3 — Rodar / ajustar / commit:**
```bash
npx vitest run src/server/services/custom-field-preset.service.test.ts
git add src/server/services/custom-field-preset.service.ts src/server/services/custom-field-preset.service.test.ts
git commit -m "feat(verticais): seed de campos reconhece escopo PRODUCT"
```

---

### Task 5.3: Pill de escopo `PRODUCT` no gerenciador de campos

Para o usuário poder criar/editar campos de ficha manualmente em `/configuracoes`.

**Files:**
- Modify: `src/components/CustomFieldsManager.tsx` (constante `SCOPES` L23-34)

**Step 1 — Adicionar `PRODUCT`** ao array `SCOPES` com rótulo amigável (ex.: `{ value: "PRODUCT", label: "Ficha do produto" }`), seguindo o formato dos existentes.

**Step 2 — Verificar** que a criação manda `scope: "PRODUCT"` (o componente já inclui `scope` só no create) e que o filtro `?scope=PRODUCT` lista certo (rota já ampliada na Task 1.1).

**Step 3 — Commit:**
```bash
git add src/components/CustomFieldsManager.tsx
git commit -m "feat(custom-fields/ui): escopo Ficha do produto (PRODUCT)"
```

> **Nav:** não é necessário item de menu novo — anúncios vivem dentro de `/catalogo`, que já aparece no grupo "Catálogo & Estoque". `MODULE_RULES` já lista `estoque` para `automotivo`. Nenhuma mudança em `src/lib/nav.ts`.

---

# FASE 6 — Fechamento

### Task 6.1: Gate verde

**Step 1 — Rodar a suíte inteira:**
```bash
npm test
```
Expected: todos verdes (os ~860 existentes + os novos). Corrigir qualquer `AttendanceToolCtx` sem `hasProductPhotos` que o TS/typecheck apontar.

**Step 2 — Lint:**
```bash
npm run lint
```
Expected: sem erros novos.

**Step 3 — Commit** (se houve ajuste de gate):
```bash
git commit -am "test: gate verde para anúncios (fotos + specs + IA)"
```

---

### Task 6.2: Checklist de deploy (documentar, não executar sem o dono)

Escrever no fim deste plano / na descrição do PR:

1. **Supabase (PROD) — aplicar ANTES do deploy de código:** rodar `prisma/manual/2026-07-13-onda-i.sql` no SQL Editor. É idempotente. (Sem isso, `/catalogo` e o atendimento quebram ao ler `CatalogItem.customFields`/`CatalogItemPhoto`.)
2. **Storage:** confirmar que `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` estão na Vercel (upload/URL assinada dependem disso; senão as fotos dão 503) — ver `[[baileys-prod-constraints]]`.
3. **Deploy web** (Vercel) — via CLI com token do time se o push estiver bloqueado (`[[vercel-hobby-push-block]]`).
4. **Worker (Oracle):** a tool `enviar_fotos` roda no caminho de atendimento; atualizar o worker (`git pull` + restart) — ver `[[worker-oracle-update-procedure]]`. Confirmar que ele tem acesso ao Storage (mesmas envs Supabase).
5. **Smoke PROD:** criar item PRODUTO, subir 1 foto, preencher ficha, e num lead de teste pedir "manda foto do <item>" → IA chama `enviar_fotos`.

---

### Task 6.3: Atualizar a memória

**Files:**
- Create: `C:\Users\Matheus\.claude\projects\c--Users-Matheus-Documents-WORK-teste-crm\memory\anuncios-catalogo-fotos-specs-feito.md`
- Modify: `...\memory\MEMORY.md` (uma linha nova no índice)

Registrar: iniciativa "Anúncios no catálogo" — `CatalogItemPhoto` + `CustomFieldScope.PRODUCT` + `CatalogItem.customFields`; tool IA `enviar_fotos`; opt-in por ramo (veículos/imóveis via preset); **onda-i.sql** (estado de aplicação em PROD — atualizar quando aplicado); reusa Storage/`enviar_midia`/comanda/estoque; vitrine pública **fora de escopo** (fase 2 futura). Seguir o formato de `type: project` com **Why/How to apply** e linkar `[[catalogo-estoque-avancado-feito]]`, `[[verticais-unificadas-feito]]`, `[[prod-schema-drift-destravar]]`, `[[design-tokens-dark-theme]]`.

---

## Notas de escopo (o que ficou de fora, de propósito)

- **Vitrine pública `/vitrine/[slug]`** com grid/filtros/branding — fase 2. Toda a base (fotos privadas + specs) já suporta; faltaria só um endpoint público de foto (signed URL sem auth, gated por `vitrineEnabled`) e a página.
- **Compressão/redimensionamento de imagem** — hoje o repo sobe o binário como veio (sem re-encode). Manter igual; se as fotos pesarem, tratar em iniciativa separada.
- **Mover Placa/Chassi/RENAVAM para PRODUCT** — deixados em `ORDER_ITEM` para não quebrar dados/uso atuais. Revisitar se o dono quiser a identidade legal do carro no anúncio.
