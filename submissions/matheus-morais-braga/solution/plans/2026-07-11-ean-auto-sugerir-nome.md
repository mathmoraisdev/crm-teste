# Auto-sugerir nome por código de barras (EAN) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** No cadastro de produto, quando o cliente bipa/digita um código de barras, o sistema consulta uma base externa de produtos e **pré-preenche o nome** (editável), sobrando ao lojista só definir o preço.

**Architecture:** Uma camada de serviço fail-open (`ean-lookup.service.ts`) com abstração de provedores (Cosmos pago + Open Food Facts grátis como fallback), fronteada por um **cache global** (tabela `EanCache`, não escopada por conta — o EAN da Coca é o mesmo p/ todo mundo). Uma rota GET fina alimenta o formulário de cadastro no `CatalogManager`. Nada bloqueia o cadastro: sem chave/erro/timeout → o campo simplesmente não é sugerido, igual hoje.

**Tech Stack:** Next.js (App Router) · Prisma/PostgreSQL · Zod · Vitest · `fetch` nativo (Node 22).

---

## Conceito que motiva o plano (leia antes)

- **Cosmos/Open Food Facts = a fonte de dados** (dicionário EAN→nome). Sozinhas não fazem nada dentro do app.
- **"Auto-sugerir nome" = o recurso deste plano**: o encanamento que chama a fonte e joga o nome no campo de cadastro.
- Não é "um ou outro": a fonte é o ingrediente; este plano é o prato.

## Escopo do MVP (o que ESTÁ e o que NÃO está)

**Está:** sugerir `name` (e guardar `brand`/`ncm` no cache p/ futuro) ao bipar no cadastro; cache global; fail-open; grátis por padrão (OFF), melhor com token Cosmos.

**NÃO está (fica p/ depois):** preço (nunca vem — é sempre do lojista); auto-preencher NCM na emissão fiscal; foto do produto; importação em massa por planilha de EANs; sugestão no PDV (lá o código já resolve p/ item cadastrado — outro fluxo, já existe em `/api/vendas/catalog/lookup`).

## Decisão de provedor (o dono escolhe antes/depois — não trava o plano)

- **Sem nada:** o fallback Open Food Facts funciona sem chave (grátis, só alimento/bebida). O recurso já sobe funcionando p/ demo.
- **Com token Cosmos** (`COSMOS_API_TOKEN`): Cosmos vira o provedor primário (melhor cobertura BR, inclui cigarro/limpeza/não-alimento). Cadastro grátis no site da Bluesoft. A URL base é env (`COSMOS_BASE_URL`) — se a Bluesoft mudar o domínio (`.com.br`↔`.io`), troca-se sem tocar código, igual aos gateways de pagamento.
- Kill-switch global: `EAN_LOOKUP_DISABLED` (default `false` = ligado). Segue o idioma da casa (`AI_TOOLCALLING_DISABLED`): p/ desligar, `EAN_LOOKUP_DISABLED=true`.

---

## Task 1: Tabela de cache global `EanCache`

**Files:**
- Modify: `prisma/schema.prisma` (adicionar `model EanCache`)
- Create: `prisma/migrations/20260711010000_ean_cache/migration.sql`

**Step 1: Adicionar o modelo ao schema**

Em `prisma/schema.prisma`, após o bloco `model CatalogItem { ... }` (ou junto aos modelos de catálogo), adicione:

```prisma
/// Cache GLOBAL (não por conta) de consultas de código de barras. O dado é
/// universal — o EAN da Coca é o mesmo p/ todas as contas — então UMA linha por
/// GTIN serve todo mundo: a 2ª conta que bipar o mesmo produto não chama a API.
/// `found = false` é cache NEGATIVO (evita rebater a base p/ um código que não
/// existe); respeitado por TTL (o produto pode entrar na base depois).
model EanCache {
  gtin      String   @id // código de barras normalizado (só dígitos)
  found     Boolean
  name      String? // descrição retornada pela fonte
  brand     String? // marca
  ncm       String? // classificação fiscal (guardada p/ futuro; não usada no MVP)
  source    String? // qual provedor respondeu ("cosmos" | "openfoodfacts")
  fetchedAt DateTime @default(now())

  @@index([fetchedAt]) // p/ eventual poda por idade no worker
}
```

**Step 2: Escrever a migration idempotente**

Crie `prisma/migrations/20260711010000_ean_cache/migration.sql` (idempotente — o build roda `migrate deploy`; `IF NOT EXISTS` sobrevive a drift de PROD, ver memória `prod-schema-drift-destravar`):

```sql
-- Cache global de código de barras (EAN → nome/marca). Ver model EanCache.
CREATE TABLE IF NOT EXISTS "EanCache" (
    "gtin"      TEXT NOT NULL,
    "found"     BOOLEAN NOT NULL,
    "name"      TEXT,
    "brand"     TEXT,
    "ncm"       TEXT,
    "source"    TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EanCache_pkey" PRIMARY KEY ("gtin")
);
CREATE INDEX IF NOT EXISTS "EanCache_fetchedAt_idx" ON "EanCache"("fetchedAt");
```

**Step 3: Aplicar local e gerar o client**

> ⚠️ Pare o `next dev` antes (memória `prisma-generate-dev-server-lock`: EPERM no rename da DLL com o dev rodando).

**NÃO use `prisma migrate dev`** — ele criaria uma pasta auto-timestampada com SQL próprio, ignorando a migration idempotente escrita à mão no Step 2. O padrão desta casa (ver a migration `20260711000000_auditoria_tier1`) é: **dev aplica via `db push`**, e a pasta de migration idempotente existe p/ o **build de PROD** (`prisma migrate deploy`).

Run: `npx prisma db push`
Expected: cria a tabela `EanCache` no banco de dev (Docker) sem gerar migration; roda `prisma generate` ao final.

Run (se o generate não rodou junto): `npx prisma generate`
Expected: `prisma.eanCache` passa a existir no client tipado.

Verifique: `npx tsc --noEmit` (ou o próximo teste) reconhece `prisma.eanCache`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260711010000_ean_cache/
git commit -m "feat(ean): tabela de cache global EanCache"
```

---

## Task 2: Variáveis de ambiente

**Files:**
- Modify: `src/lib/env.ts` (dentro do `schema = z.object({ ... })`)
- Modify: `.env.example`

**Step 1: Adicionar as envs ao schema zod**

Em `src/lib/env.ts`, adicione ao objeto do schema (perto do fim, junto às features gateadas):

```ts
  // ── Auto-sugerir nome por código de barras (EAN) ────────────────────────────
  // Kill-switch: EAN_LOOKUP_DISABLED=true desliga tudo (default false = ligado).
  // Idioma da casa (igual AI_TOOLCALLING_DISABLED) — evita a pegadinha de
  // z.coerce.boolean() com default true (lá "false" coage p/ true e não desliga).
  // ⚠️ NÃO setar =false p/ "ligar": qualquer valor não-vazio vira true. Deixe
  // AUSENTE p/ manter ligado. Sem COSMOS_API_TOKEN → usa só o Open Food Facts
  // (grátis, alimento/bebida). Tudo fail-open: erro/timeout NUNCA trava o cadastro.
  EAN_LOOKUP_DISABLED: z.coerce.boolean().default(false),
  COSMOS_BASE_URL: z.string().default("https://api.cosmos.bluesoft.com.br"),
  COSMOS_API_TOKEN: z.string().optional().default(""),
  EAN_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(4000), // cadastro é interativo: falha rápido
  EAN_NEGATIVE_TTL_DAYS: z.coerce.number().int().positive().default(30), // recheca "não achou" após N dias
```

**Step 2: Documentar no `.env.example`**

Adicione ao final de `.env.example`:

```dotenv
# Auto-sugerir nome por código de barras (EAN). Sem token = usa Open Food Facts
# (grátis). Com token da Cosmos (https://cosmos.bluesoft.com.br) = cobertura BR
# melhor, inclui não-alimento. P/ DESLIGAR: EAN_LOOKUP_DISABLED=true (deixe a
# linha ausente/comentada p/ manter ligado — não coloque =false).
# EAN_LOOKUP_DISABLED=true
COSMOS_BASE_URL=https://api.cosmos.bluesoft.com.br
COSMOS_API_TOKEN=
EAN_LOOKUP_TIMEOUT_MS=4000
EAN_NEGATIVE_TTL_DAYS=30
```

**Step 3: Verificar que o app sobe**

Run: `npm run lint`
Expected: sem erros de tipo nas novas envs.

**Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(ean): envs (kill-switch, token Cosmos, timeout, TTL negativo)"
```

---

## Task 3: Serviço de lookup (providers + cache + fail-open)

**Files:**
- Create: `src/server/services/ean-lookup.service.ts`
- Test: `src/server/services/ean-lookup.service.test.ts`

**Step 1: Escrever os testes primeiro (mock do `fetch`, prisma real p/ o cache)**

Crie `src/server/services/ean-lookup.service.test.ts`. Os testes deste repo usam prisma real (integração) — então mockamos só o `fetch` (HTTP externo) e deixamos a tabela `EanCache` real. Cada teste usa um GTIN único p/ isolar.

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "@/server/db/client";
import { normalizeGtin, lookupEan } from "./ean-lookup.service";

// GTIN aleatório de 13 dígitos por teste (isola linhas no cache global).
function gtin(): string {
  const n = Math.abs(Math.round(performance.now() * 1000)) % 1_000_000_000;
  return ("789" + String(n).padStart(10, "0")).slice(0, 13);
}

function mockFetchOnce(handler: (url: string) => { status: number; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const { status, body } = handler(String(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ean-lookup.service", () => {
  it("normalizeGtin remove tudo que não é dígito", () => {
    expect(normalizeGtin(" 789-4900 011517 ")).toBe("7894900011517");
  });

  it("miss → chama provider (OFF) → retorna nome e grava cache positivo", async () => {
    const g = gtin();
    const spy = mockFetchOnce(() => ({
      status: 200,
      body: { status: 1, product: { product_name: "Coca Cola LT 350ml", brands: "Coca-Cola" } },
    }));
    const r = await lookupEan(g);
    expect(r.found).toBe(true);
    expect(r.name).toBe("Coca Cola LT 350ml");
    expect(r.source).toBe("openfoodfacts");
    expect(spy).toHaveBeenCalled(); // não fixe a CONTAGEM: se o dev tiver COSMOS_API_TOKEN
                                    // no .env, o Cosmos também bate a rede (→ 2 chamadas).

    // 2ª chamada: servida do cache, sem novo fetch (esta é a asserção que importa).
    spy.mockClear();
    const r2 = await lookupEan(g);
    expect(r2.name).toBe("Coca Cola LT 350ml");
    expect(spy).not.toHaveBeenCalled();
  });

  it("provider diz 'não encontrado' (status 0) → grava cache negativo e não rebate dentro do TTL", async () => {
    const g = gtin();
    const spy = mockFetchOnce(() => ({ status: 200, body: { status: 0 } }));
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    expect(spy).toHaveBeenCalled();

    spy.mockClear();
    const r2 = await lookupEan(g);
    expect(r2.found).toBe(false);
    expect(spy).not.toHaveBeenCalled(); // cache negativo fresco
  });

  it("erro de rede em TODOS os providers → fail-open (found:false) e NÃO envenena o cache", async () => {
    const g = gtin();
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    const row = await prisma.eanCache.findUnique({ where: { gtin: g } });
    expect(row).toBeNull(); // outage não vira cache negativo
    spy.mockRestore();
  });

  it("gtin curto (<8) retorna found:false sem tocar rede", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await lookupEan("123");
    expect(r.found).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/ean-lookup.service.test.ts`
Expected: FAIL (`ean-lookup.service` não existe / export ausente).

**Step 3: Implementar o serviço**

Crie `src/server/services/ean-lookup.service.ts`:

```ts
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

export interface EanInfo {
  found: boolean;
  name: string | null;
  brand: string | null;
  ncm: string | null;
  source: string | null;
}

const NOT_FOUND: EanInfo = { found: false, name: null, brand: null, ncm: null, source: null };

/** Só dígitos (o leitor às vezes injeta espaço/traço). */
export function normalizeGtin(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

// Resultado tri-estado do fetch: distinguir "não achou" (definitivo) de "erro"
// (rede/timeout) evita gravar cache negativo por causa de uma queda temporária.
type FetchResult = { kind: "ok"; data: any } | { kind: "notfound" } | { kind: "error" };

async function fetchJson(url: string, headers: Record<string, string>): Promise<FetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.EAN_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 404) return { kind: "notfound" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: await res.json() };
  } catch {
    return { kind: "error" }; // timeout/rede = "não sei", não "não existe"
  } finally {
    clearTimeout(t);
  }
}

// Cada provider: EanInfo (achou) | "miss" (respondeu, não existe) | "error" (sem sinal).
type ProviderResult = EanInfo | "miss" | "error";

/** Cosmos (Bluesoft): melhor cobertura BR, inclui não-alimento. Requer token. */
async function fromCosmos(gtin: string): Promise<ProviderResult> {
  if (!env.COSMOS_API_TOKEN) return "error"; // sem token → provider pulado (não é "miss")
  const r = await fetchJson(`${env.COSMOS_BASE_URL}/gtins/${gtin}.json`, {
    "X-Cosmos-Token": env.COSMOS_API_TOKEN,
    "User-Agent": "Cosmos-API-Request",
    "Content-Type": "application/json",
  });
  if (r.kind === "notfound") return "miss";
  if (r.kind === "error") return "error";
  const name = typeof r.data?.description === "string" ? r.data.description.trim() : "";
  if (!name) return "miss";
  return {
    found: true,
    name,
    brand: r.data?.brand?.name ? String(r.data.brand.name).trim() : null,
    ncm: r.data?.ncm?.code ? String(r.data.ncm.code) : null,
    source: "cosmos",
  };
}

/** Open Food Facts: grátis, sem chave, só alimento/bebida. Fallback + base dev. */
async function fromOpenFoodFacts(gtin: string): Promise<ProviderResult> {
  const r = await fetchJson(
    `https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,brands`,
    { "User-Agent": "crm-ean-lookup/1.0" },
  );
  if (r.kind === "notfound") return "miss";
  if (r.kind === "error") return "error";
  if (r.data?.status !== 1) return "miss";
  const name = typeof r.data?.product?.product_name === "string" ? r.data.product.product_name.trim() : "";
  if (!name) return "miss"; // achou o registro mas sem nome → inútil p/ sugerir
  return {
    found: true,
    name,
    brand: r.data?.product?.brands ? String(r.data.product.brands).split(",")[0].trim() : null,
    ncm: null,
    source: "openfoodfacts",
  };
}

const PROVIDERS = [fromCosmos, fromOpenFoodFacts];

/** Consulta um código de barras → nome/marca. Cache global first, fail-open. */
export async function lookupEan(rawBarcode: string): Promise<EanInfo> {
  if (env.EAN_LOOKUP_DISABLED) return NOT_FOUND;
  const gtin = normalizeGtin(rawBarcode);
  if (gtin.length < 8) return NOT_FOUND; // EAN-8 é o menor válido

  // 1) Cache global
  const cached = await prisma.eanCache.findUnique({ where: { gtin } }).catch(() => null);
  if (cached) {
    if (cached.found) {
      return { found: true, name: cached.name, brand: cached.brand, ncm: cached.ncm, source: cached.source };
    }
    const ageDays = (Date.now() - cached.fetchedAt.getTime()) / 86_400_000;
    if (ageDays < env.EAN_NEGATIVE_TTL_DAYS) return NOT_FOUND; // negativo ainda fresco
  }

  // 2) Providers em ordem; primeiro que ACHAR vence. Registra se algum deu "miss".
  let hit: EanInfo | null = null;
  let sawMiss = false;
  for (const p of PROVIDERS) {
    const res = await p(gtin);
    if (res === "miss") { sawMiss = true; continue; }
    if (res === "error") continue;
    hit = res;
    break;
  }

  // 3) Cache: grava positivo sempre; negativo só se ALGUÉM confirmou "não existe"
  //    (evita envenenar o cache quando foi só outage/timeout em todos).
  if (hit || sawMiss) {
    const payload = {
      found: !!hit,
      name: hit?.name ?? null,
      brand: hit?.brand ?? null,
      ncm: hit?.ncm ?? null,
      source: hit?.source ?? null,
    };
    await prisma.eanCache
      .upsert({ where: { gtin }, create: { gtin, ...payload }, update: { ...payload, fetchedAt: new Date() } })
      .catch(() => { /* cache é otimização; nunca quebra o fluxo */ });
  }

  return hit ?? NOT_FOUND;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/ean-lookup.service.test.ts`
Expected: PASS (5 testes).

> Nota 1: o teste do kill-switch (`EAN_LOOKUP_DISABLED=true`) exige mock do módulo `@/lib/env` (singleton). Opcional no MVP — se for incluir, use `vi.mock("@/lib/env", ...)` num arquivo de teste separado p/ não vazar o mock aos demais.
>
> Nota 2: os testes mockam `fetch`, então NÃO batem em rede real. Se o `.env` de dev tiver `COSMOS_API_TOKEN`, o provider Cosmos entra na cadeia — por isso as asserções não fixam a contagem de chamadas, só o comportamento (achou / cache serve a 2ª / não envenena em erro).

**Step 5: Commit**

```bash
git add src/server/services/ean-lookup.service.ts src/server/services/ean-lookup.service.test.ts
git commit -m "feat(ean): servico de lookup (Cosmos+OFF, cache global, fail-open)"
```

---

## Task 4: Rota `GET /api/vendas/catalog/ean-info`

**Files:**
- Create: `src/app/api/vendas/catalog/ean-info/route.ts`

**Step 1: Implementar a rota (fina; toda a lógica está no serviço)**

Crie `src/app/api/vendas/catalog/ean-info/route.ts`. Espelha o padrão de `catalog/lookup/route.ts`, mas é helper de **cadastro** → exige `canSettings` (quem cria item). Nunca 500: o serviço já é fail-open.

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { lookupEan } from "@/server/services/ean-lookup.service";

export const dynamic = "force-dynamic";

// Sugerir nome no cadastro: bipar/digitar um EAN → nome+marca da base externa.
// Só quem cadastra (canSettings). Sempre 200 { found } — o front decide usar ou não.
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const barcode = req.nextUrl.searchParams.get("barcode") ?? "";
  const info = await lookupEan(barcode);
  return NextResponse.json({ found: info.found, name: info.name, brand: info.brand });
}
```

**Step 2: Smoke manual da rota**

Suba o dev (`npm run dev`), logue, e no console do browser:

```js
await fetch("/api/vendas/catalog/ean-info?barcode=7894900011517").then(r => r.json())
// Esperado (com OFF ativo): { found: true, name: "Refrigerante Coca-Cola 2Lt", brand: "Coca-Cola" }
```

**Step 3: Commit**

```bash
git add src/app/api/vendas/catalog/ean-info/route.ts
git commit -m "feat(ean): rota GET /api/vendas/catalog/ean-info (canSettings, fail-open)"
```

---

## Task 5: Ligar no formulário de cadastro (`CatalogManager`)

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx`

**Step 1: Estados + função de sugestão (perto dos outros `useState` do form de adicionar, ~linha 79-92)**

```tsx
const [eanBusy, setEanBusy] = useState(false);
const [eanSuggested, setEanSuggested] = useState(false); // mostra a dica "nome sugerido"
```

Adicione a função (perto de `addItem`):

```tsx
// Bipar no cadastro: resolve o EAN → nome da base externa e PRÉ-PREENCHE o nome.
// Só sugere se: é PRODUTO, tem código, e o nome ainda está vazio (nunca sobrescreve
// o que o usuário digitou). Fail-open: qualquer erro → não faz nada (cadastro segue).
async function suggestNameFromBarcode() {
  const code = barcode.trim();
  if (kind !== "PRODUTO" || !code || name.trim()) return;
  setEanBusy(true);
  try {
    const res = await fetch(`/api/vendas/catalog/ean-info?barcode=${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.found && data?.name && !name.trim()) {
      setName(data.name);
      setEanSuggested(true);
    }
  } catch {
    /* fail-open: cadastro manual normal */
  } finally {
    setEanBusy(false);
  }
}
```

Zere `eanSuggested` no `resetAddForm()` (adicione `setEanSuggested(false)` ao corpo dela, ~linha 156-172).

**Step 2: Disparar no campo de código de barras (form de adicionar, [CatalogManager.tsx:868-873](../../src/components/vendas/CatalogManager.tsx#L868-L873))**

> ⚠️ **NÃO** substitua o input inteiro (perderia a `className` existente). Apenas **acrescente os atributos** abaixo ao `<input value={barcode} ... />` que já existe, e troque o `onChange`/`placeholder`:

- `onChange` → `(e) => { setBarcode(e.target.value); setEanSuggested(false); }`
- Acrescentar: `onBlur={() => void suggestNameFromBarcode()}`
- Acrescentar: `onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void suggestNameFromBarcode(); } }}`
- Acrescentar: `disabled={eanBusy}`
- `placeholder` → `"Código de barras — bipe aqui p/ sugerir o nome"`
- **Manter** a `className` que já está lá.

**Step 3: Dica visual sob o campo Nome**

Onde o input de `name` do form de adicionar é renderizado, logo abaixo:

```tsx
{eanBusy && <p className="text-[11px] text-slate-400">Buscando nome pelo código…</p>}
{eanSuggested && !eanBusy && (
  <p className="text-[11px] text-brand-600">Nome sugerido pelo código de barras — confira e ajuste se quiser.</p>
)}
```

**Step 4: Teste no browser (o de verdade — @verify)**

1. `npm run dev`, ir em Vendas → catálogo → "Adicionar item".
2. Tipo = PRODUTO. No campo de código de barras, digitar `7894900011517` e sair do campo (Tab).
3. Esperado: campo Nome preenche "Refrigerante Coca-Cola 2Lt" + dica em azul.
4. Digitar um nome à mão ANTES de bipar → não deve ser sobrescrito.
5. Código inexistente (`0000000000000`) → nada acontece, cadastro segue manual.

**Step 5: Commit**

```bash
git add src/components/vendas/CatalogManager.tsx
git commit -m "feat(ean): cadastro sugere nome ao bipar codigo de barras"
```

---

## Task 6: (Opcional) Mesmo helper no form de edição + docs + memória

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx` (form de edição, estados `editBarcode`/`editName`)
- Modify: `docs/FUNCIONALIDADES.md`
- Create: memória `ean-auto-sugerir-nome-feito.md` + linha no `MEMORY.md`

**Step 1:** Replicar `suggestNameFromBarcode` p/ os estados de edição (`editBarcode` → `editName`), com a mesma guarda de não sobrescrever. (Pode pular no MVP: o ganho maior é no cadastro novo.)

**Step 2:** Documentar em `docs/FUNCIONALIDADES.md` na seção de catálogo: "ao bipar um código no cadastro, o sistema sugere o nome (base externa); preço é sempre do lojista".

**Step 3:** Rodar a suíte inteira: `npm test` → tudo verde.

**Step 4: Commit**

```bash
git add -A
git commit -m "docs(ean): funcionalidade + edicao sugere nome"
```

---

## Deploy (PROD)

1. **Migration:** aplicada automaticamente pelo build (`prisma migrate deploy`); é idempotente (`IF NOT EXISTS`). Nada manual — ver memória `prod-schema-drift-destravar`.
2. **Env na Vercel (web):** já sobe LIGADO (default) usando o Open Food Facts grátis — não precisa setar nada p/ ligar. Quando o dono tiver o token, setar `COSMOS_API_TOKEN=<token>` (e `COSMOS_BASE_URL` só se a Bluesoft indicar outro domínio). P/ desligar tudo: `EAN_LOOKUP_DISABLED=true`. **O worker Oracle NÃO precisa** (cadastro roda só no web).
3. **Deploy web:** via CLI (memória `vercel-hobby-push-block`): `env -u CLAUDECODE CI=1 npx vercel deploy --prod`.
4. **Smoke PROD:** logar, cadastrar produto, bipar um EAN real de marca → nome sugere. Conferir 1ª consulta grava `EanCache` e a 2ª (mesmo código) volta instantânea (cache).

## Riscos & mitigação

- **Dependência externa em fluxo de cadastro** → mitigado: cache-first + fail-open + timeout curto. Pior caso = sem sugestão (= hoje).
- **Cota da fonte grátis (OFF)** → o cache global colapsa consultas repetidas; cada EAN único bate a API só 1×. Com base de clientes pequena, folgado. Ao escalar, ligar Cosmos (token) resolve cobertura e limites.
- **Envenenar cache em outage** → resolvido no serviço: cache negativo só quando um provider confirma "não existe" (`miss`), nunca em `error`.
- **Nome "feio"/incompleto** → campo vem preenchido e **editável**; guarda de não sobrescrever o que o usuário digitou.
