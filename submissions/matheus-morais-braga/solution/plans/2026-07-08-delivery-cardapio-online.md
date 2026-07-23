# Delivery / Cardápio Online Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar a contas de alimentação um cardápio digital público (link `/cardapio/<slug>`, sem login) com carrinho, checkout, entrega/retirada, taxa por bairro e pagamento Pix online — no estilo `pedido.anot.ai` — reusando catálogo, gateway de pagamento, comanda e impressão de cozinha já existentes.

**Architecture:** O pedido online **vira uma `Order` (comanda) real** — mesmo modelo do PDV — aberta como `ABERTA` + `source=ONLINE` + `fulfillmentStatus=PENDENTE`, para herdar estoque, cozinha, fiscal e relatórios de graça. O ciclo de vida de entrega vive num campo **separado** (`fulfillmentStatus`), sem colidir com o ciclo financeiro (`status` ABERTA/FECHADA/CANCELADA). Pagamento online reusa a **abstração de gateway** (`createPixCharge`) já em produção, com `externalReference = order:<id>`; a cobrança fica no próprio `Order` (não no `Sale`, que é acoplado a Offer/Lead) e o webhook existente ganha um fallback de reconciliação por `Order`. A página pública clona o padrão de `/agendar/<slug>` (resolução por `publicSlug`, gate por flag, branding, rate-limit, allowlist do middleware).

**Tech Stack:** Next.js App Router (RSC + route handlers `runtime=nodejs`), Prisma/Postgres (Supabase em PROD), Zod, Vitest, TailwindCSS com tokens de tema, gateway Pix multi-provedor (Mercado Pago / PagBank / Asaas, BYOK cifrado), Supabase Storage (fotos assinadas sob demanda), WhatsApp (Baileys) para notificação.

**Convenções deste repo (ler antes de começar):**
- Schema em PROD é aplicado à mão via `prisma/manual/YYYY-MM-DD-onda-<letra>.sql` **idempotente** (o DB de PROD não é alcançável do CI). `schema.prisma` é a fonte de verdade do client. Ver `[[prod-schema-drift-destravar]]`. Este plano usa **Onda L**.
- Testes de **serviço** existem e são a rede de segurança (`*.service.test.ts` com Vitest). Páginas/widgets não têm teste unitário — verificam-se manualmente com a skill `verify`/`run`.
- Tema: **nunca** hex fixo nem utilities de cor default; usar tokens (`text-ink`, `bg-card`, `text-slate-500`, `bg-brand-500`). Ver `[[design-tokens-dark-theme]]`.
- DB local = container Docker `crm-postgres`. Se a app der 500 "Can't reach database", reinicie o Docker antes de culpar o código. Ver `[[local-dev-db-docker]]`.
- Windows: pare o `next dev` antes de `prisma db push`/`generate` (lock da DLL do query-engine). Ver `[[prisma-generate-dev-server-lock]]`.
- Valores monetários **sempre em centavos** (Int). Total da comanda é **derivado** (`orderTotalCents`), nunca persistido.
- Commits pequenos e frequentes, mensagem em pt-BR no padrão `feat(delivery): ...` / `test(delivery): ...`.

**Peças que já existem e o plano REUSA (não reescrever):**
- Catálogo: `src/server/services/catalog.service.ts` → `listCatalogItems`, `CatalogItemDTO`. Fotos em `CatalogItemPhoto` (path no bucket, assinar sob demanda).
- Comanda: `src/server/services/order.service.ts` → `openOrder`, `addItem`, `closeOrder`, `orderTotalCents`, `getKitchenOrder`. Estoque baixa no `closeOrder` via `applyOrderStockExit`.
- Cozinha: `src/lib/receipt/kitchen.ts` → `buildKitchenTickets`; display `/producao/[orderId]`.
- Pagamento: `src/server/payments/gateway.ts` → `gatewayFor(provider).createPixCharge({ apiKey, amountCents, description, externalReference, payerName })` + `isChargePaid` + `parseWebhookChargeId`. Resolver BYOK: `src/server/payments/resolve.ts` → `resolvePaymentForUser`. Webhook: `src/app/api/webhooks/payment/[provider]/route.ts` → `confirmPaymentByCharge` em `sales.service.ts`.
- Público/branding: `src/app/agendar/[slug]/page.tsx`, `src/server/services/branding.service.ts` → `getBranding`. Allowlist: `src/middleware.ts` `PUBLIC_PREFIXES`. Rate-limit: `@/lib/ratelimit`.
- Entitlements: `src/lib/plans.ts` `PLAN_LIMITS`, `src/server/services/entitlements.ts` → `assertFeature`/`canUseFeature`.
- Billing gate: `isAccountActive(userId)` (usado em `sendOffer`).

---

## Índice de Fases

- **Fase 0** — Fundação de schema (Onda L): enums, campos em Order/CatalogItem/User, `DeliverySettings`, `DeliveryZone`.
- **Fase 1** — Entitlement do add-on (`canSellOnline`) e gate do link público (`menuEnabled`).
- **Fase 2** — Serviços de config: `delivery-settings.service`, `delivery-zone.service` + UI em Configurações.
- **Fase 3** — Serviço do cardápio público (`menu.service`) + fotos assinadas.
- **Fase 4** — Página pública `/cardapio/[slug]` (render read-only + branding + loja aberta/fechada).
- **Fase 5** — Carrinho + checkout (client): tipo de pedido, endereço, zona→taxa, pagamento.
- **Fase 6** — API de checkout `POST /api/cardapio/[slug]/pedido` (cria Order ONLINE, valida, cria Pix).
- **Fase 7** — Reconciliação de pagamento online (extensão do webhook por `Order`).
- **Fase 8** — Gestão do lojista: fila "Pedidos online", aceitar/recusar, avançar status, imprimir cozinha.
- **Fase 9** — Acompanhamento do cliente `/cardapio/[slug]/pedido/[id]` + notificações WhatsApp.
- **Fase 10** — Horário de funcionamento, onboarding do ramo e runbook de deploy (Onda L em PROD).

Cada fase termina com o gate verde (`npm run test` + `npm run build`/typecheck) e um commit.

---

## Fase 0 — Fundação de schema (Onda L)

### Task 0.1: Escrever o SQL manual idempotente

**Files:**
- Create: `prisma/manual/2026-07-08-onda-L.sql`

**Step 1: Criar o arquivo com o DDL completo (idempotente)**

```sql
-- 2026-07-08-onda-L.sql — Delivery / Cardápio online (iniciativa 15)
-- Aplicar no Supabase SQL Editor (env do DB é Sensitive, não alcança do CI).
-- Idempotente. NÃO duplicar com migration versionada — schema da Onda entra por AQUI.

-- 1) Enums
DO $$ BEGIN CREATE TYPE "OrderType" AS ENUM ('MESA','DELIVERY','RETIRADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "OrderSource" AS ENUM ('POS','ONLINE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "FulfillmentStatus"
  AS ENUM ('PENDENTE','CONFIRMADO','EM_PREPARO','PRONTO','SAIU_ENTREGA','ENTREGUE','RECUSADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Order: tipo, origem, fulfillment, entrega, cobrança online
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderType" "OrderType";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "source" "OrderSource";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfillmentStatus" "FulfillmentStatus";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryAddress" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryZoneId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlineChargeProvider" "PaymentProvider";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlineChargeId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlinePixCopiaECola" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlinePaidAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Order_accountId_fulfillmentStatus_idx"
  ON "Order" ("accountId","fulfillmentStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_onlineChargeProvider_onlineChargeId_key"
  ON "Order" ("onlineChargeProvider","onlineChargeId");

-- 3) CatalogItem: campos de cardápio
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuCategory" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuVisible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "menuDescription" TEXT;
CREATE INDEX IF NOT EXISTS "CatalogItem_accountId_menuCategory_idx"
  ON "CatalogItem" ("accountId","menuCategory");

-- 4) User: gate do link público + flag do add-on de delivery
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "menuEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deliveryAddon" BOOLEAN NOT NULL DEFAULT false;

-- 5) DeliverySettings (1:1 conta)
CREATE TABLE IF NOT EXISTS "DeliverySettings" (
  "accountId" TEXT PRIMARY KEY,
  "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "payOnlineEnabled" BOOLEAN NOT NULL DEFAULT true,
  "payOnDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "minOrderCents" INTEGER NOT NULL DEFAULT 0,
  "defaultPrepMinutes" INTEGER NOT NULL DEFAULT 30,
  "hoursJson" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DeliverySettings_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- 6) DeliveryZone (bairros/taxas)
CREATE TABLE IF NOT EXISTS "DeliveryZone" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "feeCents" INTEGER NOT NULL DEFAULT 0,
  "minOrderCents" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DeliveryZone_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "DeliveryZone_accountId_active_idx"
  ON "DeliveryZone" ("accountId","active");
```

**Step 2: Aplicar no Postgres LOCAL (Docker) para desenvolver**

Run (garanta o Docker `crm-postgres` de pé):
```bash
docker exec -i crm-postgres psql -U postgres -d crm < prisma/manual/2026-07-08-onda-L.sql
```
Expected: sem erros; rodar 2ª vez também sem erro (prova a idempotência).

**Step 3: Commit**
```bash
git add prisma/manual/2026-07-08-onda-L.sql
git commit -m "feat(delivery): onda-L SQL (order type/fulfillment, delivery settings/zones, menu fields)"
```

---

### Task 0.2: Espelhar no `schema.prisma` (fonte de verdade do client)

**Files:**
- Modify: `prisma/schema.prisma` (enums + models `Order`, `CatalogItem`, `User` + novos models)

**Step 1: Adicionar os enums** (perto dos enums existentes `OrderStatus`/`OrderPayment`):
```prisma
enum OrderType { MESA DELIVERY RETIRADA }
enum OrderSource { POS ONLINE }
enum FulfillmentStatus {
  PENDENTE CONFIRMADO EM_PREPARO PRONTO SAIU_ENTREGA ENTREGUE RECUSADO
}
```

**Step 2: Adicionar campos ao model `Order`** (junto aos campos fiscais):
```prisma
  orderType            OrderType?
  source               OrderSource?
  fulfillmentStatus    FulfillmentStatus?
  deliveryAddress      Json?
  deliveryFeeCents     Int?
  deliveryZoneId       String?
  deliveryZone         DeliveryZone? @relation(fields: [deliveryZoneId], references: [id], onDelete: SetNull)
  customerPhone        String?
  onlineChargeProvider PaymentProvider?
  onlineChargeId       String?
  onlinePixCopiaECola  String?
  onlinePaidAt         DateTime?
```
E, junto aos `@@index` existentes de `Order`:
```prisma
  @@index([accountId, fulfillmentStatus])
  @@unique([onlineChargeProvider, onlineChargeId])
```

**Step 3: Adicionar campos ao model `CatalogItem`:**
```prisma
  menuCategory    String?
  menuVisible     Boolean @default(true)
  menuDescription String?
```
E o índice: `@@index([accountId, menuCategory])`.

**Step 4: Adicionar ao model `User`:**
```prisma
  menuEnabled      Boolean @default(false)
  deliveryAddon    Boolean @default(false)
  deliverySettings DeliverySettings?
  deliveryZones    DeliveryZone[]
```

**Step 5: Adicionar os novos models** (ao fim do arquivo):
```prisma
model DeliverySettings {
  accountId            String   @id
  account              User     @relation(fields: [accountId], references: [id], onDelete: Cascade)
  deliveryEnabled      Boolean  @default(true)
  pickupEnabled        Boolean  @default(true)
  payOnlineEnabled     Boolean  @default(true)
  payOnDeliveryEnabled Boolean  @default(true)
  minOrderCents        Int      @default(0)
  defaultPrepMinutes   Int      @default(30)
  hoursJson            Json?
  updatedAt            DateTime @updatedAt
}

model DeliveryZone {
  id            String   @id @default(cuid())
  accountId     String
  account       User     @relation(fields: [accountId], references: [id], onDelete: Cascade)
  name          String
  feeCents      Int      @default(0)
  minOrderCents Int?
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  orders        Order[]

  @@index([accountId, active])
}
```

**Step 6: Gerar o client** (pare o `next dev` antes — lock da DLL no Windows):
```bash
npx prisma generate
```
Expected: "Generated Prisma Client". Sem `prisma db push` (o schema já foi aplicado pelo SQL da Task 0.1).

**Step 7: Typecheck rápido**
```bash
npx tsc --noEmit
```
Expected: PASS (o client novo conhece os campos).

**Step 8: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat(delivery): espelha onda-L no schema.prisma"
```

---

## Fase 1 — Entitlement do add-on + gate do link público

### Task 1.1: `canSellOnline` — Pix escopado pelo add-on de delivery

Hoje `sales` (cobrança Pix) é Profissional+. O add-on de delivery precisa destravar Pix **escopado ao cardápio** mesmo no Inicial (o wedge da pizzaria). Ver `[[pricing-plans-cost]]`.

**Files:**
- Modify: `src/server/services/entitlements.ts`
- Test: `src/server/services/entitlements.test.ts` (criar se não existir)

**Step 1: Escrever o teste**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { canSellOnline } from "./entitlements";
import { prisma } from "@/server/db/client";

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("canSellOnline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("libera quando o plano já tem sales (Profissional+)", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ plan: "PROFISSIONAL", email: "a@b.com", deliveryAddon: false });
    expect(await canSellOnline("u1")).toBe(true);
  });

  it("libera no Inicial quando tem o add-on de delivery", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ plan: "INICIAL", email: "a@b.com", deliveryAddon: true });
    expect(await canSellOnline("u1")).toBe(true);
  });

  it("bloqueia no Inicial sem add-on", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ plan: "INICIAL", email: "a@b.com", deliveryAddon: false });
    expect(await canSellOnline("u1")).toBe(false);
  });

  it("libera grandfather (plan null)", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ plan: null, email: "a@b.com", deliveryAddon: false });
    expect(await canSellOnline("u1")).toBe(true);
  });
});
```

**Step 2: Rodar e ver falhar**
Run: `npm run test -- entitlements`
Expected: FAIL ("canSellOnline is not a function").

**Step 3: Implementar** (em `entitlements.ts`, reusando `isAdminEmail` e `PLAN_LIMITS` já importados no arquivo):
```ts
/** Pode cobrar online (Pix do cardápio)? Plano com `sales` OU add-on de delivery.
 *  Grandfather (plan null) e admin liberam. Espelha a régua de [[pricing-plans-cost]]. */
export async function canSellOnline(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, email: true, deliveryAddon: true },
  });
  if (!u) return false;
  if (u.plan == null || isAdminEmail(u.email)) return true;
  if (u.deliveryAddon) return true;
  return PLAN_LIMITS[u.plan].sales === true;
}
```

**Step 4: Rodar e ver passar**
Run: `npm run test -- entitlements`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/server/services/entitlements.ts src/server/services/entitlements.test.ts
git commit -m "feat(delivery): canSellOnline — Pix escopado pelo add-on"
```

---

## Fase 2 — Config: delivery settings + zonas de entrega

### Task 2.1: `delivery-settings.service` (get/upsert com defaults)

**Files:**
- Create: `src/server/services/delivery-settings.service.ts`
- Test: `src/server/services/delivery-settings.service.test.ts`

**Step 1: Escrever o teste** (usa o DB Docker local, como os outros `*.service.test.ts` de integração; se o padrão do repo for mock, siga o padrão do vizinho `pos-settings.service.test.ts`). Contrato:
```ts
import { describe, it, expect } from "vitest";
import { getDeliverySettings, updateDeliverySettings } from "./delivery-settings.service";
// helper de conta de teste do repo (ver como os outros testes criam User); aqui "acc.id"

it("getDeliverySettings devolve defaults quando não há linha", async () => {
  const s = await getDeliverySettings(acc.id);
  expect(s).toMatchObject({
    deliveryEnabled: true, pickupEnabled: true,
    payOnlineEnabled: true, payOnDeliveryEnabled: true,
    minOrderCents: 0, defaultPrepMinutes: 30, hours: null,
  });
});

it("updateDeliverySettings faz upsert e clampa negativos", async () => {
  const s = await updateDeliverySettings(acc.id, { minOrderCents: -5, defaultPrepMinutes: 45, pickupEnabled: false });
  expect(s.minOrderCents).toBe(0);
  expect(s.defaultPrepMinutes).toBe(45);
  expect(s.pickupEnabled).toBe(false);
});
```

**Step 2: Rodar e ver falhar** — `npm run test -- delivery-settings` → FAIL.

**Step 3: Implementar:**
```ts
import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";

export interface DeliverySettingsDTO {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  payOnlineEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  minOrderCents: number;
  defaultPrepMinutes: number;
  hours: DeliveryHours | null;
}

/** Horário por dia da semana (0=domingo..6=sábado). Cada dia = lista de janelas HH:MM. */
export type DeliveryHours = Record<string, { open: string; close: string }[]>;

const DEFAULTS: DeliverySettingsDTO = {
  deliveryEnabled: true, pickupEnabled: true,
  payOnlineEnabled: true, payOnDeliveryEnabled: true,
  minOrderCents: 0, defaultPrepMinutes: 30, hours: null,
};

function toDTO(row: {
  deliveryEnabled: boolean; pickupEnabled: boolean;
  payOnlineEnabled: boolean; payOnDeliveryEnabled: boolean;
  minOrderCents: number; defaultPrepMinutes: number; hoursJson: Prisma.JsonValue | null;
}): DeliverySettingsDTO {
  return {
    deliveryEnabled: row.deliveryEnabled, pickupEnabled: row.pickupEnabled,
    payOnlineEnabled: row.payOnlineEnabled, payOnDeliveryEnabled: row.payOnDeliveryEnabled,
    minOrderCents: row.minOrderCents, defaultPrepMinutes: row.defaultPrepMinutes,
    hours: (row.hoursJson as DeliveryHours | null) ?? null,
  };
}

export async function getDeliverySettings(accountId: string): Promise<DeliverySettingsDTO> {
  const row = await prisma.deliverySettings.findUnique({ where: { accountId } });
  return row ? toDTO(row) : { ...DEFAULTS };
}

export async function updateDeliverySettings(
  accountId: string,
  patch: Partial<Omit<DeliverySettingsDTO, "hours">> & { hours?: DeliveryHours | null },
): Promise<DeliverySettingsDTO> {
  const data = {
    ...(patch.deliveryEnabled !== undefined ? { deliveryEnabled: patch.deliveryEnabled } : {}),
    ...(patch.pickupEnabled !== undefined ? { pickupEnabled: patch.pickupEnabled } : {}),
    ...(patch.payOnlineEnabled !== undefined ? { payOnlineEnabled: patch.payOnlineEnabled } : {}),
    ...(patch.payOnDeliveryEnabled !== undefined ? { payOnDeliveryEnabled: patch.payOnDeliveryEnabled } : {}),
    ...(patch.minOrderCents !== undefined ? { minOrderCents: Math.max(0, Math.floor(patch.minOrderCents)) } : {}),
    ...(patch.defaultPrepMinutes !== undefined ? { defaultPrepMinutes: Math.max(0, Math.floor(patch.defaultPrepMinutes)) } : {}),
    ...(patch.hours !== undefined ? { hoursJson: (patch.hours ?? null) as Prisma.InputJsonValue } : {}),
  };
  const row = await prisma.deliverySettings.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
  return toDTO(row);
}
```

**Step 4: Rodar e ver passar** — `npm run test -- delivery-settings` → PASS.

**Step 5: Commit** — `git commit -m "feat(delivery): delivery-settings.service (get/upsert)"`.

---

### Task 2.2: `delivery-zone.service` (CRUD de bairros/taxas)

**Files:**
- Create: `src/server/services/delivery-zone.service.ts`
- Test: `src/server/services/delivery-zone.service.test.ts`

**Step 1: Teste** (contrato):
```ts
it("cria, lista (só ativas por padrão) e resolve taxa por id", async () => {
  const z = await createZone(acc.id, { name: "Centro", feeCents: 500 });
  expect(z.feeCents).toBe(500);
  const list = await listZones(acc.id);
  expect(list.map(x => x.name)).toContain("Centro");
  const fee = await resolveZoneFee(acc.id, z.id);
  expect(fee).toMatchObject({ zoneId: z.id, feeCents: 500 });
});

it("resolveZoneFee rejeita zona de outra conta", async () => {
  const z = await createZone(acc.id, { name: "X", feeCents: 100 });
  await expect(resolveZoneFee(other.id, z.id)).rejects.toThrow();
});

it("zona inativa não aparece na listagem pública", async () => {
  const z = await createZone(acc.id, { name: "Y", feeCents: 100 });
  await updateZone(acc.id, z.id, { active: false });
  expect((await listZones(acc.id)).find(x => x.id === z.id)).toBeUndefined();
  expect((await listZones(acc.id, { includeInactive: true })).find(x => x.id === z.id)).toBeDefined();
});
```

**Step 2: Ver falhar** — `npm run test -- delivery-zone` → FAIL.

**Step 3: Implementar:**
```ts
import { prisma } from "@/server/db/client";

export interface DeliveryZoneDTO {
  id: string; name: string; feeCents: number; minOrderCents: number | null; active: boolean;
}

function toDTO(z: { id: string; name: string; feeCents: number; minOrderCents: number | null; active: boolean }): DeliveryZoneDTO {
  return { id: z.id, name: z.name, feeCents: z.feeCents, minOrderCents: z.minOrderCents, active: z.active };
}

export async function listZones(accountId: string, opts?: { includeInactive?: boolean }): Promise<DeliveryZoneDTO[]> {
  const rows = await prisma.deliveryZone.findMany({
    where: { accountId, ...(opts?.includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
  });
  return rows.map(toDTO);
}

export async function createZone(accountId: string, data: { name: string; feeCents: number; minOrderCents?: number | null }): Promise<DeliveryZoneDTO> {
  const name = data.name.trim();
  if (!name) throw new Error("Informe o nome do bairro/zona.");
  const z = await prisma.deliveryZone.create({
    data: { accountId, name, feeCents: Math.max(0, Math.floor(data.feeCents)), minOrderCents: data.minOrderCents ?? null },
  });
  return toDTO(z);
}

export async function updateZone(accountId: string, id: string, patch: Partial<{ name: string; feeCents: number; minOrderCents: number | null; active: boolean }>): Promise<DeliveryZoneDTO> {
  const owned = await prisma.deliveryZone.findFirst({ where: { id, accountId } });
  if (!owned) throw new Error("Zona não encontrada.");
  const z = await prisma.deliveryZone.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.feeCents !== undefined ? { feeCents: Math.max(0, Math.floor(patch.feeCents)) } : {}),
      ...(patch.minOrderCents !== undefined ? { minOrderCents: patch.minOrderCents } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
  });
  return toDTO(z);
}

export async function deleteZone(accountId: string, id: string): Promise<void> {
  const owned = await prisma.deliveryZone.findFirst({ where: { id, accountId } });
  if (!owned) throw new Error("Zona não encontrada.");
  await prisma.deliveryZone.delete({ where: { id } });
}

/** Resolve a taxa de uma zona (tenant-safe). Zona inativa ou de outra conta → erro. */
export async function resolveZoneFee(accountId: string, zoneId: string): Promise<{ zoneId: string; feeCents: number; minOrderCents: number | null }> {
  const z = await prisma.deliveryZone.findFirst({ where: { id: zoneId, accountId, active: true } });
  if (!z) throw new Error("Zona de entrega inválida.");
  return { zoneId: z.id, feeCents: z.feeCents, minOrderCents: z.minOrderCents };
}
```

**Step 4: Ver passar** — PASS.

**Step 5: Commit** — `git commit -m "feat(delivery): delivery-zone.service (CRUD + resolveZoneFee)"`.

---

### Task 2.3: APIs autenticadas de config + UI em Configurações

**Files:**
- Create: `src/app/api/delivery/settings/route.ts` (GET/PUT)
- Create: `src/app/api/delivery/zones/route.ts` (GET/POST), `src/app/api/delivery/zones/[id]/route.ts` (PUT/DELETE)
- Create: `src/app/(app)/configuracoes/delivery/page.tsx` + client `src/components/delivery/DeliveryConfig.tsx`
- Modify: navegação/módulo de Configurações para expor "Cardápio & Delivery" (ver `[[reorganizacao-navegacao-feito]]` — nav é dado puro via `buildNav`)

**Step 1 (API):** Handlers usam `getTenantContext` (padrão do repo — ver qualquer rota sob `src/app/api/caixa/*`), leem/gravam via os serviços da Fase 2, validam corpo com Zod. Também expõem o toggle `menuEnabled` (gate do link público) via PUT em settings — grave no `User`:
```ts
// PUT /api/delivery/settings — corpo Zod parcial + menuEnabled?: boolean
// if (body.menuEnabled !== undefined) await prisma.user.update({ where:{id:accountId}, data:{ menuEnabled: body.menuEnabled }});
// const settings = await updateDeliverySettings(accountId, body);
// return NextResponse.json({ settings, menuEnabled });
```
Gate de escrita: exigir `canSettings` (papel admin) como as outras rotas de config.

**Step 2 (UI):** `DeliveryConfig.tsx` (client) com:
- Toggle "Publicar cardápio online" (`menuEnabled`) + exibe o link `.../cardapio/<slug>` com botão copiar (usar `publicSlug` do usuário; se null, orientar a definir o slug — mesmo campo do agendamento).
- Toggles: aceitar entrega / retirada / pagar online / pagar na entrega.
- Campos: pedido mínimo (R$), tempo de preparo padrão (min).
- Editor de zonas: tabela nome/taxa/mín/ativa + adicionar/editar/excluir (chama as APIs de zonas).
- Editor de horário (grid 7 dias × janelas) — pode começar simples: um par abre/fecha por dia + checkbox "fechado".
- Usar tokens de tema (`bg-card`, `text-ink`, `text-slate-500`, `border-slate-200`). Sem hex.

**Step 3: Verificação manual** — rodar `Skill(run)` ou `npm run dev`, abrir `/configuracoes/delivery`, criar 2 zonas, ligar `menuEnabled`, salvar, recarregar e conferir persistência. Alternar tema claro/escuro e checar contraste.

**Step 4: Commit** — `git commit -m "feat(delivery): config de cardápio/entrega (settings+zonas+UI)"`.

---

## Fase 3 — Serviço do cardápio público

### Task 3.1: `menu.service` — itens visíveis agrupados por categoria, com foto de capa assinada

**Files:**
- Create: `src/server/services/menu.service.ts`
- Test: `src/server/services/menu.service.test.ts`

**Step 1: Teste** (contrato):
```ts
it("agrupa itens visíveis por categoria, exclui inativos/ocultos e esgotados sem estoque", async () => {
  // seed: item A (PRODUTO, active, menuVisible, cat 'Lanches', priceCents 1500)
  //       item B (menuVisible=false) -> não aparece
  //       item C (trackStock, stockQty 0) -> aparece marcado indisponível
  const menu = await getPublicMenu(acc.id);
  const cats = menu.categories.map(c => c.name);
  expect(cats).toContain("Lanches");
  const a = menu.categories.flatMap(c => c.items).find(i => i.name === "A");
  expect(a).toMatchObject({ priceCents: 1500, available: true });
  const c = menu.categories.flatMap(c => c.items).find(i => i.name === "C");
  expect(c?.available).toBe(false);
  expect(menu.categories.flatMap(c => c.items).find(i => i.name === "B")).toBeUndefined();
});
```

**Step 2: Ver falhar** — FAIL.

**Step 3: Implementar** (foto de capa = `CatalogItemPhoto` com menor `order`; assinar via o mesmo helper de Storage usado no anúncio — reusar `getSignedUrl`/equivalente já existente; se a função de assinatura for `signMediaPath`, use-a):
```ts
import { prisma } from "@/server/db/client";
import { signMediaUrl } from "@/server/services/storage.service"; // usar o helper real do repo

export interface MenuItemDTO {
  id: string; name: string; description: string | null;
  priceCents: number; available: boolean; photoUrl: string | null;
  variantGroup: string | null;
}
export interface MenuCategoryDTO { name: string; items: MenuItemDTO[]; }
export interface PublicMenuDTO { categories: MenuCategoryDTO[]; }

const UNCATEGORIZED = "Outros";

export async function getPublicMenu(accountId: string): Promise<PublicMenuDTO> {
  const rows = await prisma.catalogItem.findMany({
    where: { accountId, active: true, menuVisible: true },
    orderBy: [{ menuCategory: "asc" }, { name: "asc" }],
    include: { photos: { orderBy: { order: "asc" }, take: 1 } },
  });

  const byCat = new Map<string, MenuItemDTO[]>();
  for (const r of rows) {
    const available = !r.trackStock || r.stockQty > 0;
    const cover = r.photos[0];
    const photoUrl = cover ? await signMediaUrl(cover.mediaPath) : null;
    const item: MenuItemDTO = {
      id: r.id, name: r.name, description: r.menuDescription, priceCents: r.priceCents,
      available, photoUrl, variantGroup: r.variantGroup ?? null,
    };
    const cat = r.menuCategory?.trim() || UNCATEGORIZED;
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(item);
  }

  const categories = [...byCat.entries()].map(([name, items]) => ({ name, items }));
  // "Outros" sempre por último
  categories.sort((a, b) => (a.name === UNCATEGORIZED ? 1 : b.name === UNCATEGORIZED ? -1 : a.name.localeCompare(b.name)));
  return { categories };
}
```
> Nota: confirmar o nome real do helper de assinatura de Storage (grep `signed`/`createSignedUrl` em `src/server/services/*storage*`); trocar `signMediaUrl` pelo símbolo correto. Assinar N capas em série é aceitável no MVP; se lento, paralelizar com `Promise.all`.

**Step 4: Ver passar** — PASS.

**Step 5: Commit** — `git commit -m "feat(delivery): menu.service (cardápio público agrupado)"`.

---

## Fase 4 — Página pública `/cardapio/[slug]`

### Task 4.1: Allowlist do middleware

**Files:**
- Modify: `src/middleware.ts` (`PUBLIC_PREFIXES`)

**Step 1:** Adicionar as duas entradas (espelha o comentário do `/agendar`):
```ts
  // Cardápio online: link público sem login (/cardapio/<slug>) + sua API.
  "/cardapio",
  "/api/cardapio",
```
**Step 2: Verificar** — `npx tsc --noEmit` PASS. Teste manual: abrir `/cardapio/qualquer` sem login **não** redireciona para `/login` (deve dar 404 do Next quando slug não existe, não redirect).
**Step 3: Commit** — `git commit -m "feat(delivery): allowlist /cardapio no middleware"`.

---

### Task 4.2: Página server-component + gate `menuEnabled` + loja aberta/fechada

**Files:**
- Create: `src/app/cardapio/[slug]/page.tsx`
- Create: `src/lib/delivery/hours.ts` (função pura `isStoreOpen(hours, now, tz)`)
- Test: `src/lib/delivery/hours.test.ts`

**Step 1 (hours, TDD):** função pura testável (não usar `Date.now()` dentro — receber `now`):
```ts
import type { DeliveryHours } from "@/server/services/delivery-settings.service";

/** Loja aberta se `now` (no fuso dado) cai em alguma janela do dia da semana.
 *  hours null → sempre aberta (conta não configurou). */
export function isStoreOpen(hours: DeliveryHours | null, now: Date, tz: string): boolean {
  if (!hours) return true;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wdMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const wd = wdMap[parts.find(p => p.type === "weekday")!.value] ?? 0;
  const hh = parts.find(p => p.type === "hour")!.value;
  const mm = parts.find(p => p.type === "minute")!.value;
  const cur = `${hh}:${mm}`;
  const windows = hours[String(wd)] ?? [];
  return windows.some(w => w.open <= cur && cur < w.close);
}
```
Teste: dia dentro/fora da janela, hours null → true, dia sem janela → false. Use `new Date("2026-07-08T14:00:00Z")` fixo (nada de `Date.now()`).

**Step 2 (page):** clonar a estrutura de `agendar/[slug]/page.tsx`:
```tsx
export const dynamic = "force-dynamic";

async function resolveAccount(slug: string) {
  const acc = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, menuEnabled: true },
  });
  if (!acc || !acc.menuEnabled) return null; // 404 idêntico p/ "não existe"/"desligado"
  return acc;
}

export default async function CardapioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const acc = await resolveAccount(slug);
  if (!acc) notFound();
  const [branding, menu, settings, zones] = await Promise.all([
    getBranding(acc.id),
    getPublicMenu(acc.id),
    getDeliverySettings(acc.id),
    listZones(acc.id),
  ]);
  const open = isStoreOpen(settings.hours, new Date(), env.SCHEDULING_TIMEZONE);
  return (
    <>
      <BrandingStyle palette={branding.palette} />
      <main className="mx-auto min-h-screen w-full max-w-md px-4 py-6">
        {/* header com logo/appName (igual agendar) + selo Aberto/Fechado */}
        <MenuStorefront
          slug={slug} menu={menu} settings={settings} zones={zones} open={open}
        />
      </main>
    </>
  );
}
```
`MenuStorefront` é o client da Fase 5. Se `open === false`, ainda mostra o cardápio mas desabilita o checkout com aviso "Fechado no momento".

**Step 3: Verificação manual** — ligar `menuEnabled` numa conta de teste com itens; abrir `/cardapio/<slug>`; ver categorias, fotos, preços, selo aberto/fechado. Tema claro/escuro.

**Step 4: Commit** — `git commit -m "feat(delivery): página pública /cardapio/[slug] + loja aberta/fechada"`.

---

## Fase 5 — Carrinho + checkout (client)

### Task 5.1: Estado do carrinho + cálculo de total (hook puro testável)

**Files:**
- Create: `src/lib/delivery/cart.ts` (redutor puro + `computeCartTotals`)
- Test: `src/lib/delivery/cart.test.ts`

**Step 1: Teste** do cálculo (centavos; taxa só quando entrega):
```ts
import { computeCartTotals } from "./cart";

it("soma itens; adiciona taxa só em delivery", () => {
  const lines = [{ id:"a", priceCents:1500, qty:2 }, { id:"b", priceCents:500, qty:1 }];
  expect(computeCartTotals(lines, { mode:"RETIRADA", feeCents:700 }))
    .toMatchObject({ subtotalCents:3500, feeCents:0, totalCents:3500 });
  expect(computeCartTotals(lines, { mode:"DELIVERY", feeCents:700 }))
    .toMatchObject({ subtotalCents:3500, feeCents:700, totalCents:4200 });
});

it("carrinho vazio zera tudo", () => {
  expect(computeCartTotals([], { mode:"DELIVERY", feeCents:700 }).totalCents).toBe(0);
});
```

**Step 2/3:** implementar `computeCartTotals(lines, { mode, feeCents })`:
```ts
export type FulfillMode = "DELIVERY" | "RETIRADA";
export interface CartLine { id: string; priceCents: number; qty: number; }
export function computeCartTotals(lines: CartLine[], opts: { mode: FulfillMode; feeCents: number }) {
  const subtotalCents = lines.reduce((s, l) => s + l.priceCents * Math.max(1, l.qty), 0);
  const feeCents = subtotalCents > 0 && opts.mode === "DELIVERY" ? Math.max(0, opts.feeCents) : 0;
  return { subtotalCents, feeCents, totalCents: subtotalCents + feeCents };
}
```
**Step 4:** PASS. **Step 5:** `git commit -m "feat(delivery): cálculo de carrinho (puro)"`.

---

### Task 5.2: Componentes de vitrine, carrinho e checkout

**Files:**
- Create: `src/components/delivery/MenuStorefront.tsx` (client — orquestra)
- Create: `src/components/delivery/CartSheet.tsx`, `src/components/delivery/CheckoutForm.tsx`

**Contrato de UX (sem gaps):**
- **Vitrine:** lista por categoria; card com foto (ou placeholder), nome, descrição, preço formatado (`Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"})`), botão "+". Item `available===false` → card esmaecido, botão desabilitado, selo "Esgotado".
- **Carrinho (CartSheet):** barra fixa inferior com total + "Ver carrinho"; sheet lista linhas com stepper qty (−/+), remove no 0; mostra subtotal, taxa (se delivery), total (usa `computeCartTotals`).
- **Checkout (CheckoutForm):** campos em ordem:
  1. Tipo: **Entrega** / **Retirada** (respeita `settings.deliveryEnabled`/`pickupEnabled` — esconde o que estiver off).
  2. Nome (obrigatório), Telefone (obrigatório, `min 8`).
  3. Se Entrega: **Bairro/zona** (select das `zones`) → seta `feeCents`; Rua, número, complemento, referência. Sem zona selecionada → bloqueia envio.
  4. Pagamento: **Pagar online (Pix)** (se `payOnlineEnabled` e a conta puder cobrar — o botão só aparece; a autorização real é no servidor) / **Pagar na entrega** (se `payOnDeliveryEnabled`).
  5. Observações (textarea, opcional).
- **Validações client (servidor é a autoridade):** loja fechada → checkout desabilitado com aviso; total < `minOrderCents` (ou `zone.minOrderCents`) → aviso "Pedido mínimo R$ X"; sem itens → botão desabilitado.
- **Envio:** `POST /api/cardapio/<slug>/pedido` com o payload da Fase 6. Em sucesso:
  - Pagamento online → mostra **Pix copia-e-cola + QR** (se `pixQrCodeBase64`) e redireciona para `/cardapio/<slug>/pedido/<id>` (acompanhamento).
  - Pagar na entrega → redireciona direto para o acompanhamento.
- Tokens de tema em tudo. Formatação BRL centralizada num helper (reusar o que o repo já tiver; grep `currency`).

**Verificação manual:** montar carrinho, alternar entrega/retirada, escolher zona e ver a taxa entrar no total, tentar enviar abaixo do mínimo (bloqueia), enviar retirada + pagar na entrega (segue para acompanhamento).

**Commit:** `git commit -m "feat(delivery): vitrine + carrinho + checkout (client)"`.

---

## Fase 6 — API de checkout (cria a Order ONLINE)

### Task 6.1: Serviço `placeOnlineOrder` (a lógica, testável)

O handler HTTP é fino; a lógica vai para o serviço para ter teste de unidade.

**Files:**
- Create: `src/server/services/online-order.service.ts`
- Test: `src/server/services/online-order.service.test.ts`
- Modify: `src/server/services/order.service.ts` — `orderTotalCents` **passa a somar `deliveryFeeCents`** (entrada opcional) para o total derivado bater com a taxa; e adicionar `deliveryFeeCents` ao `OrderDTO`/`toDTO`.

**Step 1 (ajuste do total):** teste em `order.service.test.ts`:
```ts
it("orderTotalCents soma a taxa de entrega quando informada", () => {
  expect(orderTotalCents({ items:[{unitPriceCents:1000,quantity:2}], deliveryFeeCents:700 })).toBe(2700);
});
```
Implementar: adicionar `deliveryFeeCents?: number | null` em `OrderTotalInput` e somar no retorno (`+ (input.deliveryFeeCents ?? 0)`); refletir em `toDTO` (novo campo `deliveryFeeCents` no DTO, e passar para `orderTotalCents`). Rodar a suíte de `order` inteira para garantir que nada quebrou.

**Step 2 (teste do placeOnlineOrder):** o serviço:
- valida conta + `menuEnabled`;
- valida loja aberta;
- resolve taxa da zona (se DELIVERY) e valida pedido mínimo (settings + zona);
- valida cada item (existe, `active`, `menuVisible`, estoque se `trackStock`), **snapshot de preço do servidor** (nunca confia no preço do client);
- abre a Order (`openOrder` reusado, passando `customerPhone` → cria/vincula lead), grava `orderType`, `source=ONLINE`, `fulfillmentStatus=PENDENTE`, `deliveryAddress`, `deliveryFeeCents`, `deliveryZoneId`;
- adiciona itens (`addItem` reusado, por `catalogItemId`);
- se pagamento online: checa `canSellOnline` → cria Pix (Task 6.2) → grava `onlineCharge*`.
- retorna `{ orderId, payment: "online"|"on_delivery", pix?: {...} }`.

Teste cobre: preço vem do servidor (client tenta enviar priceCents falso e é ignorado), item inativo rejeita, abaixo do mínimo rejeita, loja fechada rejeita, retirada não cobra taxa, delivery sem zona rejeita.

**Step 3: Implementar** (esqueleto com a lógica-chave):
```ts
import { prisma } from "@/server/db/client";
import { openOrder, addItem } from "./order.service";
import { getDeliverySettings } from "./delivery-settings.service";
import { resolveZoneFee } from "./delivery-zone.service";
import { getPublicMenu } from "./menu.service";
import { isStoreOpen } from "@/lib/delivery/hours";
import { canSellOnline } from "./entitlements";
import { isAccountActive } from "./billing.service"; // usar o símbolo real do gate de billing
import { createOnlinePixCharge } from "./online-payment.service"; // Task 6.2
import { env } from "@/lib/env";

export interface PlaceOnlineOrderInput {
  mode: "DELIVERY" | "RETIRADA";
  customerName: string;
  customerPhone: string;
  items: { catalogItemId: string; quantity: number; note?: string }[];
  address?: { neighborhoodZoneId?: string; street?: string; number?: string; complement?: string; reference?: string };
  payment: "online" | "on_delivery";
  note?: string;
}

export async function placeOnlineOrder(accountId: string, input: PlaceOnlineOrderInput) {
  const [settings, menu] = await Promise.all([getDeliverySettings(accountId), getPublicMenu(accountId)]);
  if (!isStoreOpen(settings.hours, new Date(), env.SCHEDULING_TIMEZONE)) throw new Error("STORE_CLOSED:Loja fechada.");
  if (input.mode === "DELIVERY" && !settings.deliveryEnabled) throw new Error("MODE_OFF:Entrega indisponível.");
  if (input.mode === "RETIRADA" && !settings.pickupEnabled) throw new Error("MODE_OFF:Retirada indisponível.");

  // Itens válidos = os do cardápio público (já filtra ativo/visível/estoque).
  const validById = new Map(menu.categories.flatMap(c => c.items).map(i => [i.id, i]));
  if (!input.items.length) throw new Error("EMPTY:Carrinho vazio.");
  for (const li of input.items) {
    const m = validById.get(li.catalogItemId);
    if (!m || !m.available) throw new Error("ITEM_UNAVAILABLE:Um item saiu do cardápio.");
  }
  const subtotal = input.items.reduce((s, li) => s + validById.get(li.catalogItemId)!.priceCents * Math.max(1, li.quantity), 0);

  // Taxa + pedido mínimo
  let deliveryFeeCents = 0, deliveryZoneId: string | null = null;
  if (input.mode === "DELIVERY") {
    if (!input.address?.neighborhoodZoneId) throw new Error("ZONE_REQUIRED:Escolha o bairro.");
    const zone = await resolveZoneFee(accountId, input.address.neighborhoodZoneId);
    deliveryFeeCents = zone.feeCents; deliveryZoneId = zone.zoneId;
    if (zone.minOrderCents != null && subtotal < zone.minOrderCents) throw new Error("MIN_ORDER:Pedido mínimo não atingido.");
  }
  if (subtotal < settings.minOrderCents) throw new Error("MIN_ORDER:Pedido mínimo não atingido.");

  // Pagamento online exige entitlement + billing ativo
  const wantsOnline = input.payment === "online";
  if (wantsOnline) {
    if (!settings.payOnlineEnabled) throw new Error("PAY_OFF:Pagamento online indisponível.");
    if (!(await canSellOnline(accountId))) throw new Error("PAY_OFF:Pagamento online indisponível.");
    if (!(await isAccountActive(accountId))) throw new Error("PAY_OFF:Pagamento online indisponível.");
  } else if (!settings.payOnDeliveryEnabled) {
    throw new Error("PAY_OFF:Pagamento na entrega indisponível.");
  }

  // Abre a comanda ONLINE (openOrder cria/vincula o lead pelo telefone).
  // openedById: usar a própria conta (accountId) como operador do pedido online.
  const dto = await openOrder(accountId, {
    openedById: accountId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
  });

  for (const li of input.items) {
    await addItem(accountId, dto.id, {
      catalogItemId: li.catalogItemId,
      quantity: li.quantity,
      ...(li.note ? { customFields: { obs: li.note } } : {}),
    });
  }

  // Metadados de delivery + fulfillment (campos que openOrder não cobre)
  await prisma.order.update({
    where: { id: dto.id },
    data: {
      orderType: input.mode === "DELIVERY" ? "DELIVERY" : "RETIRADA",
      source: "ONLINE",
      fulfillmentStatus: "PENDENTE",
      customerPhone: input.customerPhone.trim(),
      deliveryFeeCents: input.mode === "DELIVERY" ? deliveryFeeCents : null,
      deliveryZoneId,
      deliveryAddress: input.mode === "DELIVERY" ? (input.address as object) : undefined,
      note: input.note?.trim() || null,
    },
  });

  let pix: { copiaECola: string; qrBase64?: string } | undefined;
  if (wantsOnline) {
    const totalCents = subtotal + deliveryFeeCents;
    pix = await createOnlinePixCharge(accountId, dto.id, totalCents, input.customerName);
  }

  return { orderId: dto.id, payment: input.payment, pix };
}
```
> Confirmar o símbolo real do gate de billing (`isAccountActive`) e o helper de moeda. `openedById=accountId` é aceitável (o dono é o "operador" do pedido online); se houver constraint, usar o admin da conta.

**Step 4:** rodar suíte `online-order` + `order` → PASS.

**Step 5: Commit** — `git commit -m "feat(delivery): placeOnlineOrder + taxa no total derivado"`.

---

### Task 6.2: `createOnlinePixCharge` (gateway direto, sem Sale)

**Files:**
- Create: `src/server/services/online-payment.service.ts`
- Test: `src/server/services/online-payment.service.test.ts` (mock do gateway, como `sales.service`/`gateway.test.ts`)

**Step 1: Teste** — mocka `resolvePaymentForUser` e `gatewayFor(...).createPixCharge`; verifica que `externalReference === "order:<id>"`, que grava `onlineChargeProvider/onlineChargeId/onlinePixCopiaECola` no Order, e devolve copia-e-cola.

**Step 2/3: Implementar:**
```ts
import { prisma } from "@/server/db/client";
import { resolvePaymentForUser } from "@/server/payments/resolve";
import { gatewayFor } from "@/server/payments/gateway";

export async function createOnlinePixCharge(
  accountId: string, orderId: string, amountCents: number, payerName: string,
): Promise<{ copiaECola: string; qrBase64?: string }> {
  const resolved = await resolvePaymentForUser(accountId); // { provider, apiKey } | null
  if (!resolved) throw new Error("PAY_OFF:Conta sem gateway de pagamento configurado.");
  const charge = await gatewayFor(resolved.provider).createPixCharge({
    apiKey: resolved.apiKey,
    amountCents,
    description: `Pedido ${orderId.slice(0, 8)}`,
    externalReference: `order:${orderId}`,
    payerName,
  });
  await prisma.order.update({
    where: { id: orderId },
    data: {
      onlineChargeProvider: resolved.provider,
      onlineChargeId: charge.providerChargeId,
      onlinePixCopiaECola: charge.pixCopiaECola,
    },
  });
  return { copiaECola: charge.pixCopiaECola, qrBase64: charge.pixQrCodeBase64 };
}
```
**Step 4:** PASS. **Step 5:** `git commit -m "feat(delivery): createOnlinePixCharge (gateway direto no Order)"`.

---

### Task 6.3: Route handler público `POST /api/cardapio/[slug]/pedido`

**Files:**
- Create: `src/app/api/cardapio/[slug]/pedido/route.ts`

**Step 1: Implementar** (clona a espinha de `agendar/[slug]/route.ts`: rate-limit por IP+slug, resolve conta por `publicSlug`+`menuEnabled`, Zod, mapeia erros prefixados para status):
```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["DELIVERY", "RETIRADA"]),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(8),
  items: z.array(z.object({
    catalogItemId: z.string().min(1),
    quantity: z.number().int().min(1).max(99),
    note: z.string().trim().max(280).optional(),
  })).min(1),
  address: z.object({
    neighborhoodZoneId: z.string().optional(),
    street: z.string().optional(), number: z.string().optional(),
    complement: z.string().optional(), reference: z.string().optional(),
  }).optional(),
  payment: z.enum(["online", "on_delivery"]),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { rateLimit } = await import("@/lib/ratelimit");
  const rl = await rateLimit(`menu:order:${clientIp(req)}:${slug}`, 15, 60);
  if (!rl.ok) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const account = await prisma.user.findUnique({ where: { publicSlug: slug }, select: { id: true, menuEnabled: true } });
  if (!account || !account.menuEnabled) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });

  try {
    const res = await placeOnlineOrder(account.id, parsed.data);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao registrar o pedido.";
    // Erros de regra vêm prefixados "CODE:mensagem" → 409 (conflito de estado) com mensagem limpa.
    const known = ["STORE_CLOSED","MODE_OFF","ITEM_UNAVAILABLE","ZONE_REQUIRED","MIN_ORDER","PAY_OFF","EMPTY"];
    const code = msg.split(":")[0];
    const clean = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1) : msg;
    if (known.includes(code)) return NextResponse.json({ error: clean, code }, { status: 409 });
    return NextResponse.json({ error: "Erro ao registrar o pedido." }, { status: 400 });
  }
}
```
(`clientIp` copiado do handler de agendamento.)

**Step 2: Verificação manual (E2E do caminho feliz)** — via `curl`/cliente: montar pedido de retirada `on_delivery` → 201 com `orderId`; conferir no DB que a Order nasceu `source=ONLINE`, `fulfillmentStatus=PENDENTE`, itens com preço do servidor.

**Step 3: Commit** — `git commit -m "feat(delivery): POST /api/cardapio/[slug]/pedido"`.

---

## Fase 7 — Reconciliação de pagamento online

### Task 7.1: Webhook confirma pedido online por `Order`

O webhook atual (`confirmPaymentByCharge`) só conhece `Sale`. Adicionar um **fallback**: se nenhum `Sale` casar com `(provider, chargeId)`, procurar `Order` por `(onlineChargeProvider, onlineChargeId)` e confirmar.

**Files:**
- Modify: `src/server/services/sales.service.ts` (`confirmPaymentByCharge`)
- Test: `src/server/services/sales.service.test.ts` (novo caso) ou um novo `online-payment.confirm.test.ts`

**Step 1: Teste** — dado um `Order` com `onlineChargeProvider/onlineChargeId` e o gateway retornando `isChargePaid=true`, `confirmPaymentByCharge(provider, chargeId)`:
- seta `Order.onlinePaidAt`;
- é **idempotente** (2ª chamada não duplica efeito);
- não confirma se `isChargePaid=false`.

**Step 2: Implementar** — no fim de `confirmPaymentByCharge`, antes de retornar quando o Sale não é achado:
```ts
// Fallback: pedido online do cardápio (cobrança mora no Order, não no Sale).
const order = await prisma.order.findFirst({
  where: { onlineChargeProvider: provider, onlineChargeId: providerChargeId },
  select: { id: true, accountId: true, onlinePaidAt: true },
});
if (order) {
  if (order.onlinePaidAt) return; // idempotente
  const resolved = await resolvePaymentForUser(order.accountId);
  if (!resolved) return;
  const paid = await gatewayFor(provider).isChargePaid(resolved.apiKey, providerChargeId);
  if (!paid) return;
  await prisma.order.update({ where: { id: order.id }, data: { onlinePaidAt: new Date() } });
  // Notifica o lojista que ENTROU pedido pago (Fase 8 expõe a fila; aqui dispara o aviso).
  await notifyMerchantNewOnlineOrder(order.accountId, order.id).catch(() => {});
  return;
}
```
> `notifyMerchantNewOnlineOrder` é criado na Fase 8. Para pedidos `on_delivery` (sem Pix), o aviso ao lojista sai na Task 6.1 logo após criar a Order (chamar o mesmo notificador ali). Assim: pago-online avisa no webhook; pagar-na-entrega avisa na criação.

**Step 3:** PASS. **Step 4:** `git commit -m "feat(delivery): webhook confirma pedido online por Order (fallback)"`.

---

## Fase 8 — Gestão do lojista (fila, aceitar/recusar, status, cozinha)

### Task 8.1: Serviço de fulfillment

**Files:**
- Create: `src/server/services/fulfillment.service.ts`
- Test: `src/server/services/fulfillment.service.test.ts`

**Contrato + máquina de estados** (tenant-safe, só afeta `Order.source=ONLINE`):
```
PENDENTE ──confirm──▶ CONFIRMADO ──advance──▶ EM_PREPARO ─▶ PRONTO ─▶ SAIU_ENTREGA ─▶ ENTREGUE
   └──────────────── reject ─────────────▶ RECUSADO
```
- `listOnlineOrders(accountId, { status? })` — pedidos `source=ONLINE`, ordenados por `createdAt desc`, com resumo (nome, telefone, tipo, total derivado, pago?, endereço/zona).
- `confirmOnlineOrder(accountId, orderId)` — `PENDENTE→CONFIRMADO`; retorna os tickets de cozinha (`getKitchenOrder` + `buildKitchenTickets`) para impressão/produção.
- `rejectOnlineOrder(accountId, orderId, reason)` — `PENDENTE→RECUSADO`; se estava pago online, registra nota para estorno manual (MVP: sem estorno automático — logar e instruir; documentar isso).
- `advanceOnlineOrder(accountId, orderId)` — avança um passo na cadeia CONFIRMADO→…→ENTREGUE; em `ENTREGUE`, se `RETIRADA`/entrega concluída, chamar `closeOrder` (baixa estoque + fiscal + relatórios) — decisão: **fechar a comanda ao ENTREGUE** com `payment` = PIX (se pago online) ou DINHEIRO/OUTRO (se na entrega). Guardar `tenders` coerentes.
- Guardas: transição inválida lança erro; tenant-safe (`findFirst where id+accountId`).

Testar cada transição + rejeição + idempotência + fechar-ao-entregar baixando estoque.

**Commit:** `git commit -m "feat(delivery): fulfillment.service (máquina de estados do pedido online)"`.

---

### Task 8.2: `notifyMerchantNewOnlineOrder` + APIs autenticadas

**Files:**
- Create: `src/server/services/fulfillment-notify.service.ts` (`notifyMerchantNewOnlineOrder`)
- Create: `src/app/api/delivery/orders/route.ts` (GET lista), `.../orders/[id]/confirm|reject|advance/route.ts` (POST)

**Notificação ao lojista:** MVP pragmático — reusar o WhatsApp da conta (Baileys) para mandar ao **próprio número do dono** um resumo "🛎️ Novo pedido online #… — <tipo> — R$ <total>"; e/ou marcar na Inbox. Se a infra de notificação interna já existir (grep `notify`/`presence`/Inbox), usar. Fallback: apenas registrar e a fila da UI (Task 8.3) faz polling. Não bloquear o fluxo se a notificação falhar (`.catch`).

**APIs:** autenticadas via `getTenantContext` + gate `canSettings`/operador; delegam ao `fulfillment.service`. `confirm` retorna os tickets para o client disparar impressão (reusar `print-client.ts`).

**Commit:** `git commit -m "feat(delivery): notificação de novo pedido + APIs de fulfillment"`.

---

### Task 8.3: UI "Pedidos online" (fila do lojista)

**Files:**
- Create: `src/app/(app)/pedidos/page.tsx` + `src/components/delivery/OnlineOrdersBoard.tsx`
- Modify: nav (`buildNav`) — expor "Pedidos" no grupo de atendimento/vendas, **visível só quando `menuEnabled`** (fail-open como o resto da nav; ver `[[reorganizacao-navegacao-feito]]`).

**Contrato:** board estilo kanban simples por coluna de status (PENDENTE / CONFIRMADO / EM_PREPARO / PRONTO / SAIU_ENTREGA), card com nome, tipo, itens, total, selo "Pago"/"Na entrega", endereço. Ações no card: **Confirmar** (imprime cozinha + abre `/producao/<id>`), **Recusar** (pede motivo), **Avançar**. Polling a cada ~15s (ou reusar SSE/presence se houver). Som/ًbadge opcional ao chegar PENDENTE novo.

**Verificação manual (E2E completo):** criar pedido pelo `/cardapio/<slug>` → aparece PENDENTE na fila → Confirmar imprime ticket de cozinha → Avançar até ENTREGUE fecha a comanda e baixa estoque (conferir `stockQty`).

**Commit:** `git commit -m "feat(delivery): fila de pedidos online (board + ações)"`.

---

## Fase 9 — Acompanhamento do cliente + notificações

### Task 9.1: Página pública de acompanhamento

**Files:**
- Create: `src/app/cardapio/[slug]/pedido/[id]/page.tsx` + client `OrderTracker.tsx`
- Create: `src/app/api/cardapio/[slug]/pedido/[id]/route.ts` (GET status público, rate-limited)

**Contrato:** GET público devolve **só o necessário** (status de fulfillment, tipo, total, e — se pendente e online — o Pix copia-e-cola/QR); resolve por `publicSlug`+`menuEnabled` e confere que a Order pertence à conta. Nunca vazar dados de outra comanda. `OrderTracker` faz polling (~10s), mostra timeline (Recebido → Confirmado → Em preparo → Pronto → Saiu → Entregue), e o Pix enquanto `onlinePaidAt` for null.

**Verificação manual:** abrir o link após checkout; ver status mudar conforme o lojista avança na fila; pagar o Pix (sandbox) e ver "pago".

**Commit:** `git commit -m "feat(delivery): acompanhamento público do pedido"`.

---

### Task 9.2: Notificações WhatsApp ao cliente nas transições

**Files:**
- Modify: `src/server/services/fulfillment.service.ts` (disparar mensagem no `confirm`/`advance`)
- Reuso: o mesmo caminho de envio de WhatsApp já usado pelos lembretes de agenda / pós-venda (grep `sendText`/`enqueueOutbound`).

**Contrato:** ao `CONFIRMADO` → "✅ Seu pedido foi confirmado! Preparo ~<prepMin> min."; `SAIU_ENTREGA` → "🛵 Saiu para entrega!"; `PRONTO` (retirada) → "📦 Pronto para retirada!". Enviar ao `customerPhone` (lead). Não bloquear a transição se o envio falhar. Respeitar o gate de billing/opt-in do worker se aplicável (ver `[[automacao-ciclo-vida-feito]]` para o padrão inerte/opt-in).

**Verificação manual + Commit:** `git commit -m "feat(delivery): avisos WhatsApp ao cliente por status"`.

---

## Fase 10 — Horário, onboarding e deploy

### Task 10.1: Passo de onboarding do ramo alimentação

**Files:**
- Modify: a função pura de onboarding por ramo (`planOnboardingSteps`) — ver `[[onboarding-por-ramo-feito]]`.
- Test: espelhar o teste existente de `planOnboardingSteps`.

**Contrato:** para ramo alimentação/food, incluir passos: "Monte seu cardápio" (→ catálogo com `menuVisible`/`menuCategory`), "Configure entrega e taxas" (→ `/configuracoes/delivery`), "Publique seu cardápio" (→ ligar `menuEnabled` + copiar link). Estado por contagem real (itens no cardápio, zonas criadas, `menuEnabled`). Sem schema.

**Commit:** `git commit -m "feat(onboarding): passos de cardápio/delivery para ramo alimentação"`.

---

### Task 10.2: Gate verde final + build

**Step 1:** `npm run test` (suíte inteira) → PASS. Corrigir quebras.
**Step 2:** `npm run build` (ou `next build`) → PASS (typecheck + rotas).
**Step 3:** rodar a skill `verify` no fluxo principal (cria pedido → confirma → entrega) e a skill `run` para screenshot do `/cardapio/<slug>`.
**Commit:** `git commit -m "chore(delivery): gate verde (testes + build)"`.

---

### Task 10.3: Runbook de deploy (Onda L)

> **Não** rodar em PROD agora — este é o checklist para quando for publicar. Segue o padrão de `[[prod-schema-drift-destravar]]` e dos deploys anteriores.

1. **Schema em PROD:** aplicar `prisma/manual/2026-07-08-onda-L.sql` no **Supabase SQL Editor** (idempotente; rodar 2× para conferir). Sem isso, `/cardapio` e `/pedidos` dão 500.
2. **Web (Vercel):** deploy do código (`git push` ou CLI com token do time — ver `[[vercel-hobby-push-block]]`). Conferir `APP_URL`/`APP_PUBLIC_URL` setadas (o link do cardápio e do acompanhamento usam — ver `[[app-url-vercel-localhost-links]]`).
3. **Worker (Oracle):** `git pull` + `systemctl restart crm-worker` (ver `[[worker-oracle-update-procedure]]`) — necessário se as notificações/confirmação de pagamento rodam no worker. Garantir env do gateway (`resolvePaymentForUser` usa chave cifrada → `ENCRYPTION_KEY`).
4. **Por conta (dono):** definir `publicSlug` (se ainda não), ligar `menuEnabled` em `/configuracoes/delivery`, criar zonas, e — para cobrar online no Inicial — setar `deliveryAddon=true` (via painel Financeiro/admin) OU estar em Profissional+. Conectar o token do gateway Pix (BYOK) e fazer 1 pedido-teste (smoke): retirada `on_delivery` + delivery `online` (pagar Pix sandbox → ver `onlinePaidAt` e a fila confirmar).
5. **Smoke de segurança:** `/cardapio/<slug-inexistente>` → 404; conta com `menuEnabled=false` → 404; pedido abaixo do mínimo → 409.

**Commit final:** `git commit -m "docs(delivery): runbook de deploy da Onda L"`.

---

## Riscos & decisões registradas (para não reabrir amanhã)

- **Pedido online = Order real (não Sale).** `Sale` exige `offerId`+`leadId` (acoplado ao funil de Offer) — reusá-lo forçaria um Offer por pedido. A cobrança mora no `Order` e o webhook ganhou fallback. Decisão consciente.
- **Dois ciclos separados:** `status` (financeiro: ABERTA/FECHADA/CANCELADA) × `fulfillmentStatus` (operacional). A comanda fecha (`closeOrder`, que baixa estoque e emite fiscal) **ao ENTREGUE** — não antes — para não baixar estoque de pedido recusado.
- **Preço é sempre do servidor.** O client nunca dita `priceCents`; `placeOnlineOrder` re-snapshota do cardápio. Vale para taxa (vem da zona no servidor) também.
- **Estorno de pedido recusado pago-online:** MVP **não** estorna automático — registra e instrui o dono. Automatizar é fase futura (precisa `refund` na abstração de gateway, que hoje não existe).
- **Sem rastreio de motoboy / mapa / cupom / pedido agendado** no MVP — fora de escopo (é a "paridade total" com anot.ai, não o wedge).
- **Categorias do cardápio = string flat** (`menuCategory`), como `variantGroup`. Modelo dedicado só se virar necessidade.
- **Fuso:** reusar `env.SCHEDULING_TIMEZONE` para "loja aberta/fechada" (mesma fonte da agenda).

## Ganchos de memória a atualizar ao concluir

- Criar memória `delivery-cardapio-online-feito.md` (iniciativa 15) no índice `MEMORY.md`, no padrão das outras "…-feito": o que ficou pronto, onda-L (aplicada? pendente PROD?), decisões (Order-not-Sale, fulfillmentStatus, canSellOnline), e o que falta o dono fazer (slug, menuEnabled, deliveryAddon, token do gateway).
- Atualizar `[[pricing-plans-cost]]` quando os add-ons (Delivery/Fiscal) virarem cobrança de fato.
