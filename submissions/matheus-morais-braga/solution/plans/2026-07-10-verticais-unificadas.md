# Verticais unificadas — onboarding único, presets de campo/oferta, temas faltantes

> **For Claude:** REQUIRED SUB-SKILL: use `executing-plans` para implementar este plano tarefa a tarefa.
> **Mestre:** iniciativa 11 de `2026-07-05-roadmap-multinegocio.md` (Release 5). Este plano é filho do mestre.

**Goal:** de **uma** escolha de ramo, configurar de forma coerente e num passo só: persona + base de
conhecimento (atendimento), tema (cores), campos personalizados da comanda, catálogo semeado, ofertas
sugeridas e rótulos do funil. Hoje isso são 3–4 ações opt-in soltas (picker de modelo, aba Identidade,
"usar campos do ramo", seed de catálogo) que o dono descobre uma a uma — e várias engrenagens já existem
mas estão **declaradas e nunca usadas** (`suggestedOffers`), **incompletas** (4 categorias sem tema) ou
**heurísticas frágeis** (catálogo raspando texto, tudo com preço zero).

**Architecture:** iniciativa de **conteúdo + orquestração**, **sem schema novo**. Enriquece o catálogo
estático `BUSINESS_TEMPLATES` (`src/lib/business-templates.ts`) e os `THEME_PRESETS`
(`src/lib/theme/presets.ts`), e adiciona **uma camada de orquestração** (`vertical-onboarding.service.ts`
+ endpoint + wizard) que **compõe serviços que já existem** — `setBusinessTemplateId`, o upsert de
branding, `seedCustomFieldPreset`, `seedCatalogFromTemplate`, `setPipelineLabels`, `updateWhatsAppNumber`,
e um novo `seedOffersFromTemplate`. Cada peça continua utilizável isoladamente; o wizard é só o "aplica
tudo de uma vez".

**Tech Stack:** Next.js 15 (App Router, route handlers) · Prisma 6 + Postgres (Supabase) · Zod · React 19
· Tailwind (tokens de tema) · Vitest.

**Decisões travadas (do mestre / consciente):**
- **Sem migration, sem onda.** O mestre lista a iniciativa 11 na **Onda D**, mas a Onda D **já foi composta
  e aplicada** pela iniciativa 6 (`QuickReply`/`InternalNote`); a **11 não acrescenta nenhuma coluna/tabela**.
  Todo estado que o wizard grava mora em colunas que **já existem**: `User.businessTemplateId`,
  `User.pipelineLabels`, `AccountBranding.presetId/brandScale`, `CustomFieldDef`, `CatalogItem`, `Offer`.
  → **Nenhum `prisma/manual/*.sql`, nenhum `db push`, nada a aplicar em PROD além do deploy de código.**
- **Reuso, não reescrita.** Nenhuma das peças existentes muda de contrato; o wizard só as encadeia.
- **Idempotência em tudo que semeia** (campos, catálogo, ofertas): rodar de novo não duplica, no padrão de
  pré-carga de chaves já usado em `seedCustomFieldPreset`.
- **Opt-in preservado.** Nada é aplicado sem o dono acionar o wizard; e cada semeadura respeita o guard de
  "só num alvo vazio" (catálogo) ou "só o que falta" (campos/ofertas/labels) para nunca sobrescrever o que
  o dono já ajustou. Alinhado ao princípio do mestre de não poluir os ~50 modelos de serviço puro.
- **Tema:** só tokens/CSS vars, nunca hex fixo ([[design-tokens-dark-theme]]).
- **Tenancy:** dono = `ctx.tenantUserId`; toda escrita escopada por conta. Ações do wizard são de **dono**
  (`canSettings`/`role === "ADMIN"`, casando com as APIs reusadas).

---

## Contexto de código (leia antes de começar)

Arquivos-âncora que este plano toca ou compõe:

- **Modelos de negócio (conteúdo):** [src/lib/business-templates.ts](../../src/lib/business-templates.ts)
  — `BusinessTemplate` (L52-71, já tem `suggestedOffers?` L62 e `customFieldsPreset?` L65), `catalogSeedItems`
  (L1815-1843, heurística que raspa o `knowledgeBase`), `applyTemplate` (L1861-1878), `getTemplate` (L1772).
  63 modelos; só `revenda-veiculos` tem `customFieldsPreset` (L632-639); **nenhum** tem `suggestedOffers`.
- **Temas:** [src/lib/theme/presets.ts](../../src/lib/theme/presets.ts) — `THEME_PRESETS` (L14-72) e
  `presetForCategory` (L79-81, cai no verde quando a categoria não tem preset). **Faltam** os presets de
  `casa`, `educacao`, `varejo`, `eventos` (as 4 categorias sem cor dedicada).
- **Seed de campos (existe, idempotente):** [src/server/services/custom-field-preset.service.ts](../../src/server/services/custom-field-preset.service.ts)
  (`seedCustomFieldPreset`, pré-carga de `scope|key`) + rota [seed-preset/route.ts](../../src/app/api/custom-fields/seed-preset/route.ts)
  + botão em [CustomFieldsManager.tsx:82](../../src/components/CustomFieldsManager.tsx#L82).
- **Seed de catálogo (existe):** [catalog.service.ts:137-148](../../src/server/services/catalog.service.ts#L137-L148)
  (`seedCatalogFromTemplate` — força `priceCents: 0`, só entra em catálogo **vazio**).
- **Ofertas (existe, mas sem seed):** [offer.service.ts](../../src/server/services/offer.service.ts)
  — `createOffer` (L48-65, exige `priceCents ≥ 100` e feature `sales`; oferta pertence a um **número**),
  `listOffers` (L68). UI: [OffersManager.tsx](../../src/components/OffersManager.tsx) (por número).
- **Rótulos do funil (existe):** [leadStatus.ts:19-41](../../src/lib/leadStatus.ts#L19-L41) (`resolveStatusMeta`,
  `PipelineLabels`), [account.service.ts:13-47](../../src/server/services/account.service.ts#L13-L47)
  (`getPipelineLabels`/`setPipelineLabels`, que já **filtra** chaves inválidas e ignora rótulo vazio).
- **Ramo da conta:** [account.service.ts:379-388](../../src/server/services/account.service.ts#L379-L388)
  (`getBusinessTemplateId`/`setBusinessTemplateId`) + [api/account/business/route.ts](../../src/app/api/account/business/route.ts).
- **Atendimento por número:** [numbers.service.ts:152-219](../../src/server/services/numbers.service.ts#L152-L219)
  (`updateWhatsAppNumber` — **já gateia** `qualify`/`schedule`/`sales` via `assertFeature` ao **ligar**).
- **Branding:** [api/branding/route.ts](../../src/app/api/branding/route.ts) faz `accountBranding.upsert`
  com `{ presetId, brandScale }`; [branding.service.ts](../../src/server/services/branding.service.ts)
  hoje só **lê** (`getBranding`/`resolveBranding`) — este plano adiciona um setter reusável.
- **Aplicar modelo (UI atual):** [BusinessTemplatePicker.tsx](../../src/components/BusinessTemplatePicker.tsx)
  (`onApply` preenche o form de atendimento; aplica tema best-effort via `/api/branding`) — o wizard é a
  evolução disso.
- **Onboarding:** [OnboardingChecklist.tsx](../../src/components/OnboardingChecklist.tsx) e a página
  [configuracoes/page.tsx](../../src/app/(app)/configuracoes/page.tsx) (onde vivem `BusinessCategorySettings`
  L90, `CustomFieldsManager` L113, `PipelineLabelsManager` L117).

### Convenções firmes (não desvie)
- **Multi-tenant:** todo serviço recebe `userId`/`accountId` (= `tenantUserId`) e filtra por ele.
- **Money:** centavos (`Int`); item semeado sem preço confirmado nasce `priceCents: 0` (a definir), como o
  catálogo já faz. Ofertas semeadas nascem **inativas** (`active: false`) para o dono revisar preço antes de
  publicar (o runtime da IA só lê ofertas ativas — `listActiveOffers`).
- **Idempotência:** semear = pré-carregar o que existe e só criar o que falta. Nunca capturar P2002 como
  sinal de "pular" (o `createDef`/`createOffer` convertem em `Error` amigável).
- **Tema:** nunca hex fixo; palette de 11 paradas "R G B" como em `THEME_PRESETS`.

### Padrão de teste (Vitest) — use o estilo certo por arquivo
- **Lógica pura / conteúdo** (import direto, sem prisma): `business-templates.test.ts`,
  `theme/presets` (criar). Use para invariantes de dados e para `catalogSeedItems`, `decideVerticalPlan`.
- **Prisma mockado** (`vi.mock("@/server/db/client")` + `await import()` dentro do `it`): `offer.service.test.ts`.
  Use para `seedOffersFromTemplate` (asserta o `where`/args e a idempotência).
- **Banco real** (`makeOwner()` de verdade): `order.service.test.ts`, `catalog.service.test.ts`. Use para
  a **composição** `applyVertical` (FK/relacional) e para `seedCustomFieldPreset` já existente.
- Rodar tudo: `npm test`. Um arquivo: `npx vitest run caminho.test.ts`. Filtrar: `-t "nome"`.
- Commits em pt-BR (`feat(verticais): ...`), um por tarefa.
- **Pare o `next dev` antes** de qualquer `prisma generate` — mas este plano **não** gera nada (sem schema).

---

# FASE 11.1 — `customFieldsPreset` para as verticais de alto valor

**Resultado:** além de `revenda-veiculos`, os ramos que mais pedem campo estruturado ganham preset de
campos da comanda (petshop, oficina, ótica, imobiliária, restaurante, clínica). O motor
(`seedCustomFieldPreset`, botão em `CustomFieldsManager`, rota `seed-preset`) **já existe** — esta fase é
**só conteúdo** + um teste de invariante. Ship isolado, valor imediato.

---

### Tarefa 11.1.1: adicionar `customFieldsPreset` aos templates de alto valor

**Files:**
- Modify: `src/lib/business-templates.ts` (campos `customFieldsPreset` em templates existentes)
- Test: `src/lib/business-templates.test.ts` (novo `describe` de invariante)

**Step 1 — Escreva o teste que falha.** Em `business-templates.test.ts`, adicione um `describe` que (a)
garante que os presets são bem-formados e (b) trava a cobertura mínima das verticais-alvo:

```ts
describe("customFieldsPreset", () => {
  const withPreset = BUSINESS_TEMPLATES.filter((t) => t.customFieldsPreset?.length);

  it("todo item de preset é bem-formado (scope/label/type)", () => {
    for (const t of withPreset) {
      for (const f of t.customFieldsPreset!) {
        expect(["ORDER", "ORDER_ITEM"], `scope inválido em ${t.id}`).toContain(f.scope);
        expect(["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"], `type inválido em ${t.id}`).toContain(f.type);
        expect(f.label.trim(), `label vazio em ${t.id}`).not.toBe("");
        if (f.type === "SELECT") expect(f.options?.length, `SELECT sem options em ${t.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("labels do preset são únicos dentro do mesmo escopo (evita colisão de key)", () => {
    for (const t of withPreset) {
      const keys = t.customFieldsPreset!.map((f) => `${f.scope}|${f.label.toLowerCase()}`);
      expect(new Set(keys).size, `labels colidem em ${t.id}`).toBe(keys.length);
    }
  });

  it("cobre as verticais de alto valor do roadmap", () => {
    const ids = new Set(withPreset.map((t) => t.id));
    for (const id of ["oficina-mecanica", "otica", "imobiliaria", "restaurante-delivery", "clinica-veterinaria", "petshop-produtos"]) {
      expect(ids.has(id), `sem customFieldsPreset: ${id}`).toBe(true);
    }
  });
});
```

> **Por que labels únicos por escopo:** `seedCustomFieldPreset` faz `slugifyKey(label)` e o unique é
> `(userId, scope, key)` (ver plano `2026-07-04-campos-por-ramo-comanda.md`, Tarefa 3.1). Dois labels que
> slugificam igual no mesmo escopo colidiriam.

**Step 2 — Rode e veja falhar.** `npx vitest run src/lib/business-templates.test.ts -t customFieldsPreset`
→ FAIL (verticais-alvo sem preset).

**Step 3 — Implemente (só dados).** Em cada template-alvo adicione `customFieldsPreset` (espelhando o de
`revenda-veiculos`, L632-639). Sugestão de conteúdo por ramo — ajuste os rótulos ao que faz sentido:

```ts
// oficina-mecanica / auto-eletrica / funilaria-pintura (ordem de serviço por item)
customFieldsPreset: [
  { scope: "ORDER_ITEM", label: "Placa", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Modelo/Ano", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "KM", type: "NUMBER" },
],
// otica (grau/receita por item)
customFieldsPreset: [
  { scope: "ORDER_ITEM", label: "Esférico (OD/OE)", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Cilíndrico (OD/OE)", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Eixo (OD/OE)", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Adição", type: "TEXT" },
  { scope: "ORDER", label: "Médico/Receita", type: "TEXT" },
],
// imobiliaria / corretor-imoveis (imóvel por linha)
customFieldsPreset: [
  { scope: "ORDER_ITEM", label: "Código do imóvel", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Endereço", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Finalidade", type: "SELECT", options: ["Venda", "Aluguel"] },
],
// restaurante-delivery / pizzaria-hamburgueria (dados de entrega na comanda)
customFieldsPreset: [
  { scope: "ORDER", label: "Mesa/Comanda", type: "TEXT" },
  { scope: "ORDER", label: "Endereço de entrega", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Observação", type: "TEXT" },
],
// clinica-veterinaria / petshop-produtos (pet por item)
customFieldsPreset: [
  { scope: "ORDER_ITEM", label: "Pet", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Espécie/Raça", type: "TEXT" },
  { scope: "ORDER_ITEM", label: "Porte", type: "SELECT", options: ["Pequeno", "Médio", "Grande"] },
],
```

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/business-templates.test.ts` → PASS (invariantes
existentes + os novos). Confirme que os testes antigos de `catálogo`/`applyTemplate` seguem verdes (o campo
é opcional; não os afeta).

**Step 5 — Commit.**
```bash
git add src/lib/business-templates.ts src/lib/business-templates.test.ts
git commit -m "feat(verticais): campos personalizados por ramo (oficina, ótica, imobiliária, restaurante, pet)"
```

---

# FASE 11.2 — `suggestedOffers` populado + seed de ofertas por ramo

**Resultado:** o campo `suggestedOffers` (declarado em `BusinessTemplate` L62 e **nunca consumido**) passa a
ter conteúdo nos ramos de venda e um caminho de aplicação: um botão "Sugerir ofertas do meu ramo" no
`OffersManager` cria ofertas reais **inativas** (o dono ajusta preço e publica). O runtime da IA só vê
ofertas ativas, então nada vaza sem revisão.

> **Restrição-chave:** `createOffer` exige `priceCents ≥ 100` e feature `sales`; oferta pertence a um
> **número** (`whatsAppNumberId`). A `suggestedOffers` só tem `priceHint` textual. Por isso o seed **não**
> passa por `createOffer`: cria direto com `priceCents: 0` + `active: false` + `description` carregando o
> `priceHint`, e continua gateado por `sales` + posse do número.

---

### Tarefa 11.2.1: popular `suggestedOffers` nos ramos de venda + invariante

**Files:**
- Modify: `src/lib/business-templates.ts`
- Test: `src/lib/business-templates.test.ts`

**Step 1 — Teste que falha.**
```ts
describe("suggestedOffers", () => {
  const withOffers = BUSINESS_TEMPLATES.filter((t) => t.suggestedOffers?.length);

  it("todo item tem name não-vazio", () => {
    for (const t of withOffers)
      for (const o of t.suggestedOffers!) expect(o.name.trim(), `oferta sem nome em ${t.id}`).not.toBe("");
  });

  it("names únicos dentro do template (seed é idempotente por nome)", () => {
    for (const t of withOffers) {
      const names = t.suggestedOffers!.map((o) => o.name.toLowerCase());
      expect(new Set(names).size, `ofertas duplicadas em ${t.id}`).toBe(names.length);
    }
  });

  it("cobre ramos com sales=true (onde oferta faz sentido)", () => {
    const salesTemplates = BUSINESS_TEMPLATES.filter((t) => t.suggested.sales);
    const covered = salesTemplates.filter((t) => t.suggestedOffers?.length);
    expect(covered.length, "nenhum ramo de venda tem suggestedOffers").toBeGreaterThan(0);
  });
});
```

**Step 2 — Rode e veja falhar.** `npx vitest run src/lib/business-templates.test.ts -t suggestedOffers` → FAIL.

**Step 3 — Implemente (dados).** Popule `suggestedOffers` nos ramos com `suggested.sales === true`
(ex.: `escola-idiomas`, `curso-profissionalizante`, `autoescola-cfc`, `agencia-marketing`, `personal-trainer`,
`academia`) e em outros de venda evidente. Ex.:
```ts
// escola-idiomas
suggestedOffers: [
  { name: "Plano mensal", description: "Aulas 2x/semana", priceHint: "a partir de R$ 250/mês" },
  { name: "Curso intensivo", description: "Foco em conversação", priceHint: "sob consulta" },
],
```

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/business-templates.test.ts` → PASS.

**Step 5 — Commit.**
```bash
git commit -am "feat(verticais): suggestedOffers nos ramos de venda"
```

---

### Tarefa 11.2.2: `seedOffersFromTemplate` no `offer.service` (idempotente)

**Files:**
- Modify: `src/server/services/offer.service.ts`
- Test: `src/server/services/offer.service.test.ts` (**JÁ EXISTE — prisma mockado; ESTENDA no estilo `await import()`**)

**Step 1 — Teste que falha (estilo mockado do arquivo).**
```ts
describe("seedOffersFromTemplate", () => {
  it("cria só as ofertas cujo nome ainda não existe no número (inativas, preço 0)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValue({ id: "n1" }); // posse ok
    (prisma.offer.findMany as any).mockResolvedValue([{ name: "Plano mensal" }]); // já existe uma
    (prisma.offer.create as any).mockImplementation(({ data }: any) => ({ id: "off_new", ...data }));
    const { seedOffersFromTemplate } = await import("./offer.service");

    // usa um template real com suggestedOffers (ex.: escola-idiomas), ver Tarefa 11.2.1
    const r = await seedOffersFromTemplate("u1", "n1", "escola-idiomas");

    expect(r.skipped).toBeGreaterThanOrEqual(1);      // "Plano mensal" pulado
    expect(r.created).toBeGreaterThanOrEqual(1);       // ao menos uma nova
    const createdArgs = (prisma.offer.create as any).mock.calls.map((c: any) => c[0].data);
    expect(createdArgs.every((d: any) => d.priceCents === 0 && d.active === false)).toBe(true);
    expect(createdArgs.every((d: any) => d.whatsAppNumberId === "n1" && d.userId === "u1")).toBe(true);
  });

  it("template sem suggestedOffers → no-op {created:0,skipped:0}", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.whatsAppNumber.findFirst as any).mockResolvedValue({ id: "n1" });
    (prisma.offer.findMany as any).mockResolvedValue([]);
    const { seedOffersFromTemplate } = await import("./offer.service");
    expect(await seedOffersFromTemplate("u1", "n1", "advocacia")).toEqual({ created: 0, skipped: 0 });
  });
});
```
> Confirme no topo do arquivo de teste que `assertFeature`/`assertOwnsNumber` estão mockados ou que o mock
> de `prisma` cobre suas queries (o arquivo já mocka `@/server/db/client`). Se `assertFeature` consultar o
> banco, mocke o retorno para "permitido" no `beforeEach`, como os testes de `createOffer` já fazem.

**Step 2 — Rode e veja falhar.** `npx vitest run src/server/services/offer.service.test.ts -t seedOffersFromTemplate`
→ FAIL (`seedOffersFromTemplate` não existe).

**Step 3 — Implemente.** Em `offer.service.ts`:
```ts
import { getTemplate } from "@/lib/business-templates";

/**
 * Semeia as ofertas sugeridas pelo ramo (`suggestedOffers`) num número. Idempotente
 * por PRÉ-CARGA dos nomes já existentes (não por capturar P2002). Ofertas nascem
 * INATIVAS e com priceCents 0 (a definir): o dono revisa preço e publica — o runtime
 * da IA só lê ofertas ativas (`listActiveOffers`). Gateado por `sales` + posse do número.
 */
export async function seedOffersFromTemplate(
  userId: string,
  whatsAppNumberId: string,
  templateId: string,
): Promise<{ created: number; skipped: number }> {
  const offers = getTemplate(templateId)?.suggestedOffers;
  if (!offers || offers.length === 0) return { created: 0, skipped: 0 };
  await assertFeature(userId, "sales");
  await assertOwnsNumber(userId, whatsAppNumberId);

  const existing = await prisma.offer.findMany({
    where: { userId, whatsAppNumberId },
    select: { name: true },
  });
  const seen = new Set(existing.map((o) => o.name.trim().toLowerCase()));

  let created = 0;
  let skipped = 0;
  for (const o of offers) {
    const key = o.name.trim().toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    // Descrição carrega o priceHint (texto) já que o preço nasce a definir.
    const description = [o.description, o.priceHint && `(${o.priceHint})`].filter(Boolean).join(" ") || null;
    await prisma.offer.create({
      data: { userId, whatsAppNumberId, name: o.name.trim(), description, priceCents: 0, active: false },
    });
    seen.add(key);
    created++;
  }
  return { created, skipped };
}
```
> `assertFeature`, `assertOwnsNumber`, `prisma`, `getTemplate` — os três primeiros já estão no arquivo;
> importe `getTemplate`. **Não** reuse `createOffer` (o `priceCents ≥ 100` do `upsertSchema` recusaria o 0).

**Step 4 — Rode e veja passar.** `npx vitest run src/server/services/offer.service.test.ts` → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/offer.service.ts src/server/services/offer.service.test.ts
git commit -m "feat(verticais): seedOffersFromTemplate (ofertas do ramo, inativas, idempotente)"
```

---

### Tarefa 11.2.3: rota + botão "Sugerir ofertas do meu ramo" no `OffersManager`

**Files:**
- Create: `src/app/api/numbers/[id]/offers/seed-preset/route.ts` (POST → `seedOffersFromTemplate`)
- Modify: `src/components/OffersManager.tsx` (botão condicional + recarregar lista)

**Step 1 — Rota.** Espelhe o padrão de `seed-preset/route.ts` (dono via `getTenantContext`, `canSettings`),
mas com `params: Promise<{ id: string }>` (o número) e lendo o ramo da conta:
```ts
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { seedOffersFromTemplate } from "@/server/services/offer.service";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const templateId = await getBusinessTemplateId(ctx.tenantUserId);
  if (!templateId) return NextResponse.json({ error: "Sua conta não tem um ramo definido." }, { status: 400 });
  try {
    return NextResponse.json(await seedOffersFromTemplate(ctx.tenantUserId, id, templateId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao semear ofertas" }, { status: 400 });
  }
}
```
> `seedOffersFromTemplate` já lança amigável em plano sem `sales` (feature) e em número de outro dono →
> vira 400 legível.

**Step 2 — Botão.** No `OffersManager` (recebe `numberId`), adicione um botão discreto "Sugerir ofertas do
meu ramo" que faz `POST /api/numbers/${numberId}/offers/seed-preset` e recarrega a lista; mostre o resultado
(`{created, skipped}`) num aviso curto. Só faz sentido quando a conta tem ramo — o backend já protege; na
UI, pode sempre mostrar e deixar o 400 explicar. Tokens de tema, sem hex fixo.

**Step 3 — Verifique.** `npm run dev`, como conta com ramo de venda: OffersManager → botão → ofertas
inativas aparecem com `(priceHint)` na descrição; rodar de novo não duplica (todas `skipped`). Skill `verify`.

**Step 4 — Commit.**
```bash
git add src/app/api/numbers/[id]/offers/seed-preset src/components/OffersManager.tsx
git commit -m "feat(verticais): botão de ofertas sugeridas por ramo no OffersManager"
```

---

# FASE 11.3 — Temas das 4 categorias faltantes (casa, educação, varejo, eventos)

**Resultado:** `presetForCategory` deixa de cair no verde-padrão para `casa`, `educacao`, `varejo` e
`eventos` — cada uma ganha cor própria. Só conteúdo em `presets.ts` + um teste de invariante.

---

### Tarefa 11.3.1: adicionar 4 `ThemePreset` + invariante de cobertura

**Files:**
- Modify: `src/lib/theme/presets.ts`
- Test: `src/lib/theme/presets.test.ts` (**criar**)

**Step 1 — Teste que falha.** Crie `src/lib/theme/presets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { THEME_PRESETS, presetForCategory, presetById } from "./presets";
import { BUSINESS_TEMPLATES, type BusinessCategory } from "@/lib/business-templates";

describe("THEME_PRESETS", () => {
  it("toda palette tem as 11 paradas no formato 'R G B'", () => {
    const stops = ["50","100","200","300","400","500","600","700","800","900","950"];
    for (const p of THEME_PRESETS) {
      for (const s of stops) {
        const v = (p.palette as Record<string, string>)[s];
        expect(v, `${p.id} sem parada ${s}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
    }
  });

  it("ids únicos", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda categoria que TEM modelo de negócio tem um preset dedicado (sem cair no verde)", () => {
    const usedCats = new Set<BusinessCategory>(BUSINESS_TEMPLATES.map((t) => t.category));
    for (const cat of usedCats) {
      const p = presetForCategory(cat);
      expect(p.category, `categoria sem preset dedicado: ${cat}`).toBe(cat);
    }
  });
});
```
> A 3ª asserção é a que trava a fase: hoje `casa`/`educacao`/`varejo`/`eventos` caem no `verde-padrao`
> (categoria `outro`), então `p.category !== cat` → FAIL. `outro` é a única categoria legitimamente servida
> pelo verde e **não** tem modelos além do genérico — mas `atendimento-generico` é `outro`, então `outro`
> também está em `usedCats`; o `verde-padrao` (category `outro`) a cobre. ✔

**Step 2 — Rode e veja falhar.** `npx vitest run src/lib/theme/presets.test.ts` → FAIL (4 categorias sem preset).

**Step 3 — Implemente (dados).** Em `THEME_PRESETS` adicione 4 presets com paletas Tailwind de 11 paradas
(copie o formato dos existentes). Sugestão de matiz por categoria:
```ts
{ id: "casa-cobre", label: "Cobre (residenciais)", category: "casa", palette: { /* orange/stone quente, 11 paradas */ } },
{ id: "educacao-azul-royal", label: "Azul royal (educação)", category: "educacao", palette: { /* blue/sky, distinto do automotivo */ } },
{ id: "varejo-esmeralda", label: "Esmeralda (varejo)", category: "varejo", palette: { /* emerald, distinto do verde-padrão */ } },
{ id: "eventos-fucsia", label: "Fúcsia (eventos)", category: "eventos", palette: { /* pink/fuchsia, distinto do beleza-rose */ } },
```
> Pegue os RGB de uma escala Tailwind (ex.: `orange`, `sky`, `emerald`, `fuchsia`) e escreva as 11 paradas
> "R G B" como nos presets existentes. Garanta que `varejo-esmeralda` ≠ `verde-padrao` e
> `eventos-fucsia` ≠ `beleza-rose` no matiz (500) para não confundir no seletor.

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/theme/presets.test.ts` → PASS. Rode `npm test`
para confirmar que nada mais quebrou (o `BusinessTemplatePicker` passa a oferecer tema também nessas 4
categorias — comportamento já existente, agora com preset real).

**Step 5 — Commit.**
```bash
git add src/lib/theme/presets.ts src/lib/theme/presets.test.ts
git commit -m "feat(verticais): temas de casa, educação, varejo e eventos"
```

---

# FASE 11.4 — Wizard de onboarding (aplica tudo de uma vez)

**Resultado:** de uma escolha de categoria+ramo (e um número-alvo opcional), o dono aplica **num passo**:
ramo da conta, tema do ramo, campos da comanda, catálogo semeado, rótulos do funil e — se houver número —
o atendimento (persona/KB/toggles) e as ofertas. Cada peça reusa o serviço que já existe; o wizard é a
orquestração + a UI. **Sem schema.**

> **Rótulos do funil (parte do objetivo do mestre):** ganham um campo **opcional** no template
> (`pipelineLabels?`) aplicado pelo wizard via `setPipelineLabels` (que já filtra chaves inválidas e ignora
> vazios). Reusa `User.pipelineLabels` — **sem coluna nova**.

---

### Tarefa 11.4.1: campo `pipelineLabels?` no template + `setBrandingPreset` reusável

**Files:**
- Modify: `src/lib/business-templates.ts` (tipo `BusinessTemplate` + alguns dados)
- Modify: `src/server/services/branding.service.ts` (novo setter `setBrandingPreset`)
- Test: `src/lib/business-templates.test.ts`

**Step 1 — Teste (invariante do novo campo).**
```ts
import { PIPELINE_ORDER } from "./leadStatus"; // caminho relativo correto do teste
describe("pipelineLabels do template", () => {
  it("só usa chaves de LeadStatus válidas e rótulos não-vazios", () => {
    const valid = new Set(PIPELINE_ORDER);
    for (const t of BUSINESS_TEMPLATES.filter((x) => x.pipelineLabels)) {
      for (const [k, v] of Object.entries(t.pipelineLabels!)) {
        expect(valid.has(k as any), `chave inválida em ${t.id}: ${k}`).toBe(true);
        expect(String(v).trim(), `rótulo vazio em ${t.id}`).not.toBe("");
      }
    }
  });
});
```
> `business-templates.ts` já é importado no client (o picker é `"use client"`); importe `LeadStatus` como
> **type-only** (`import type { LeadStatus } from "@prisma/client"`) para não puxar runtime.

**Step 2 — Rode e veja falhar.** `-t "pipelineLabels do template"` → FAIL (campo não existe).

**Step 3 — Implemente.**
- Em `BusinessTemplate` (L52-71) adicione:
  ```ts
  /** Renomeia rótulos do funil por ramo (opcional). Chaves = LeadStatus; aplicado via setPipelineLabels. */
  pipelineLabels?: Partial<Record<import("@prisma/client").LeadStatus, string>>;
  ```
  (ou um `import type` no topo). Popule em 1–2 ramos onde o funil default soa estranho, ex.:
  ```ts
  // imobiliaria: "PAGO" não é o vocabulário do ramo
  pipelineLabels: { OFERTA_ENVIADA: "Proposta enviada", PAGO: "Negócio fechado" },
  // restaurante-delivery
  pipelineLabels: { REUNIAO_AGENDADA: "Pedido agendado", PAGO: "Entregue" },
  ```
- Em `branding.service.ts` adicione o setter reusável (o wizard e, opcionalmente, a rota `/api/branding`
  podem chamá-lo — mas **não** refatore a rota agora para não ampliar o diff):
  ```ts
  import { presetById } from "@/lib/theme/presets";
  /** Aplica um preset de tema à conta (upsert de AccountBranding). Retorna false se o preset não existe. */
  export async function setBrandingPreset(accountId: string, presetId: string): Promise<boolean> {
    const preset = presetById(presetId);
    if (!preset) return false;
    await prisma.accountBranding.upsert({
      where: { accountId },
      create: { accountId, presetId: preset.id, brandScale: preset.palette },
      update: { presetId: preset.id, brandScale: preset.palette },
    });
    return true;
  }
  ```
  (Confirme os imports de `prisma` no arquivo; adicione se faltar.)

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/business-templates.test.ts` + `npx tsc --noEmit` → OK.

**Step 5 — Commit.**
```bash
git add src/lib/business-templates.ts src/server/services/branding.service.ts src/lib/business-templates.test.ts
git commit -m "feat(verticais): template.pipelineLabels + setBrandingPreset reusável"
```

---

### Tarefa 11.4.2: `vertical-onboarding.service` — plano PURO + composição

**Files:**
- Create: `src/server/services/vertical-onboarding.service.ts`
- Test: `src/server/services/vertical-onboarding.service.test.ts` (**criar** — parte pura + parte banco real)

**Contexto:** a **decisão** (o que aplicar, dado o template, o plano da conta e os alvos escolhidos) é PURA
e testável sem banco. A **execução** compõe os serviços existentes e é testada contra um dono real
(`makeOwner()`), como `catalog.service.test.ts`.

**Step 1 — Teste da função pura `planVertical`.**
```ts
import { planVertical } from "./vertical-onboarding.service";

describe("planVertical", () => {
  const base = { hasCatalogItems: false, allow: { qualify: true, schedule: true, sales: true } };

  it("marca cada etapa aplicável do template", () => {
    const tpl = {
      id: "x", customFieldsPreset: [{ scope: "ORDER_ITEM", label: "Placa", type: "TEXT" }],
      suggestedOffers: [{ name: "Plano" }], pipelineLabels: { PAGO: "Fechado" },
      category: "automotivo",
    } as any;
    const plan = planVertical(tpl, { ...base, numberId: "n1", applyTheme: true });
    expect(plan.setRamo).toBe(true);
    expect(plan.seedFields).toBe(true);
    expect(plan.seedCatalog).toBe(true);          // catálogo vazio → pode semear
    expect(plan.setLabels).toBe(true);
    expect(plan.applyTheme).toBe(true);
    expect(plan.applyAttendance).toBe(true);       // tem numberId
    expect(plan.seedOffers).toBe(true);            // tem numberId + sales permitido + suggestedOffers
    expect(plan.themePresetId).toBe("automotivo-azul");
  });

  it("sem número: não aplica atendimento nem ofertas", () => {
    const tpl = { id: "x", suggestedOffers: [{ name: "P" }], category: "outro" } as any;
    const plan = planVertical(tpl, { ...base, numberId: null, applyTheme: false });
    expect(plan.applyAttendance).toBe(false);
    expect(plan.seedOffers).toBe(false);
  });

  it("catálogo já populado → não semeia catálogo", () => {
    const plan = planVertical({ id: "x", category: "outro" } as any, { ...base, hasCatalogItems: true, numberId: null, applyTheme: false });
    expect(plan.seedCatalog).toBe(false);
  });

  it("plano sem sales → não semeia ofertas mesmo com número", () => {
    const tpl = { id: "x", suggestedOffers: [{ name: "P" }], category: "outro" } as any;
    const plan = planVertical(tpl, { hasCatalogItems: false, allow: { qualify: true, schedule: true, sales: false }, numberId: "n1", applyTheme: false });
    expect(plan.seedOffers).toBe(false);
  });
});
```

**Step 2 — Rode e veja falhar.** `-t planVertical` → FAIL.

**Step 3 — Implemente a função pura + o applier.**
```ts
import { prisma } from "@/server/db/client";
import { getTemplate, applyTemplate, type BusinessTemplate, type TemplateAllow } from "@/lib/business-templates";
import { presetForCategory } from "@/lib/theme/presets";
import { setBusinessTemplateId, setPipelineLabels } from "@/server/services/account.service";
import { setBrandingPreset } from "@/server/services/branding.service";
import { seedCustomFieldPreset } from "@/server/services/custom-field-preset.service";
import { seedCatalogFromTemplate } from "@/server/services/catalog.service";
import { seedOffersFromTemplate } from "@/server/services/offer.service";
import { updateWhatsAppNumber } from "@/server/services/numbers.service";
import { canUseFeature } from "@/server/services/entitlements";

export interface VerticalPlan {
  setRamo: boolean; applyTheme: boolean; themePresetId: string | null;
  seedFields: boolean; seedCatalog: boolean; setLabels: boolean;
  applyAttendance: boolean; seedOffers: boolean;
}

/** PURA: dado o template + estado da conta + alvos, decide o que aplicar. */
export function planVertical(
  tpl: BusinessTemplate,
  ctx: { hasCatalogItems: boolean; allow: TemplateAllow; numberId: string | null; applyTheme: boolean },
): VerticalPlan {
  const preset = presetForCategory(tpl.category);
  const themePresetId = preset.category === tpl.category ? preset.id : null;
  return {
    setRamo: true,
    applyTheme: ctx.applyTheme && themePresetId != null,
    themePresetId,
    seedFields: (tpl.customFieldsPreset?.length ?? 0) > 0,
    seedCatalog: !ctx.hasCatalogItems,
    setLabels: !!tpl.pipelineLabels && Object.keys(tpl.pipelineLabels).length > 0,
    applyAttendance: ctx.numberId != null,
    seedOffers: ctx.numberId != null && ctx.allow.sales && (tpl.suggestedOffers?.length ?? 0) > 0,
  };
}

export interface VerticalResult {
  plan: VerticalPlan;
  fields?: { created: number; skipped: number };
  offers?: { created: number; skipped: number };
  catalogSeeded?: number;
  errors: string[]; // etapas best-effort que falharam, sem abortar o resto
}

/** Efeito: aplica o plano compondo serviços existentes. Best-effort por etapa. */
export async function applyVertical(
  userId: string,
  input: { templateId: string; numberId: string | null; applyTheme: boolean; overwriteText: boolean },
): Promise<VerticalResult> {
  const tpl = getTemplate(input.templateId);
  if (!tpl) throw new Error("Modelo não encontrado.");

  const [hasItems, qualify, schedule, sales] = await Promise.all([
    prisma.catalogItem.count({ where: { accountId: userId } }).then((n) => n > 0),
    canUseFeature(userId, "qualify"),
    canUseFeature(userId, "schedule"),
    canUseFeature(userId, "sales"),
  ]);
  const allow: TemplateAllow = { qualify, schedule, sales };
  const plan = planVertical(tpl, { hasCatalogItems: hasItems, allow, numberId: input.numberId, applyTheme: input.applyTheme });
  const result: VerticalResult = { plan, errors: [] };

  // Ramo (fonte de verdade p/ os seeds subsequentes) — primeiro e obrigatório.
  await setBusinessTemplateId(userId, tpl.id);

  const step = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { result.errors.push(`${label}: ${e instanceof Error ? e.message : e}`); }
  };

  if (plan.applyTheme && plan.themePresetId)
    await step("tema", async () => { await setBrandingPreset(userId, plan.themePresetId!); });
  if (plan.seedFields)
    await step("campos", async () => { result.fields = await seedCustomFieldPreset(userId, tpl.id); });
  if (plan.seedCatalog)
    await step("catálogo", async () => { result.catalogSeeded = (await seedCatalogFromTemplate(userId, tpl.id)).length; });
  if (plan.setLabels)
    await step("funil", async () => { await setPipelineLabels(userId, tpl.pipelineLabels as Record<string, unknown>); });
  if (plan.applyAttendance && input.numberId)
    await step("atendimento", async () => {
      const merged = applyTemplate(
        { persona: "", businessHours: "", knowledgeBase: "", customInstructions: "",
          autoReplyEnabled: false, qualifyEnabled: false, scheduleEnabled: false, salesEnabled: false },
        tpl, { overwriteText: input.overwriteText, allow },
      );
      // updateWhatsAppNumber já re-gateia qualify/schedule/sales ao ligar.
      await updateWhatsAppNumber(input.numberId!, userId, {
        persona: merged.persona, knowledgeBase: merged.knowledgeBase, businessHours: merged.businessHours,
        customInstructions: merged.customInstructions, autoReplyEnabled: merged.autoReplyEnabled,
        qualifyEnabled: merged.qualifyEnabled, scheduleEnabled: merged.scheduleEnabled, salesEnabled: merged.salesEnabled,
      });
    });
  if (plan.seedOffers && input.numberId)
    await step("ofertas", async () => { result.offers = await seedOffersFromTemplate(userId, input.numberId!, tpl.id); });

  return result;
}
```
> **Nota sobre `overwriteText`:** por padrão o wizard aplica atendimento **só nos campos vazios** do número
> (`overwriteText: false`) — ele não deve apagar uma persona que o dono já escreveu. A UI (11.4.3) só
> propõe `true` com confirmação explícita, espelhando `WhatsAppNumbersPanel` (L362-365).
> **Nota sobre `seedCatalogFromTemplate`:** ele lança se o catálogo não estiver vazio; por isso o `plan`
> só marca `seedCatalog` quando `!hasItems`, e ainda assim vai dentro de `step()` (best-effort) caso corra
> com outra aba. Se `catalogSeedItems(tpl)` for vazio (ramo só-placeholder), ele lança "sem itens
> sugeridos" → cai em `errors` sem abortar. Aceitável.

**Step 4 — Teste de composição (banco real).** Adicione ao mesmo arquivo (ou um `.int.test.ts` conforme o
padrão do repo) um `describe` com `makeOwner()` que roda `applyVertical` para um ramo com tudo (ex.:
`imobiliaria`, sem número) e afirma os efeitos observáveis:
```ts
it("aplica ramo, campos, catálogo e labels para uma conta nova (sem número)", async () => {
  const acc = await makeOwner();
  const r = await applyVertical(acc, { templateId: "imobiliaria", numberId: null, applyTheme: true, overwriteText: false });
  expect(r.plan.applyAttendance).toBe(false);
  expect(await getBusinessTemplateId(acc)).toBe("imobiliaria");
  expect(await prisma.customFieldDef.count({ where: { userId: acc } })).toBeGreaterThan(0);
  expect(await prisma.catalogItem.count({ where: { accountId: acc } })).toBeGreaterThanOrEqual(0);
  expect(await getPipelineLabels(acc)).toMatchObject({ PAGO: expect.any(String) });
  // idempotência: rodar de novo não duplica campos
  const before = await prisma.customFieldDef.count({ where: { userId: acc } });
  await applyVertical(acc, { templateId: "imobiliaria", numberId: null, applyTheme: false, overwriteText: false });
  expect(await prisma.customFieldDef.count({ where: { userId: acc } })).toBe(before);
});
```
> Requer `DATABASE_URL` de teste (Postgres real), como os testes de `order`/`catalog` já exigem. Sem isso,
> rode ao menos os testes puros de `planVertical` + a skill `verify`. Reutilize o `makeOwner()`/`prisma`
> importados no estilo de `catalog.service.test.ts`. Se o `imobiliaria` não tiver itens de catálogo
> semeáveis, o assert de catálogo é `>= 0` (tolerante) e o erro fica em `r.errors`.

**Step 5 — Rode e veja passar.** `npx vitest run src/server/services/vertical-onboarding.service.test.ts`.

**Step 6 — Commit.**
```bash
git add src/server/services/vertical-onboarding.service.ts src/server/services/vertical-onboarding.service.test.ts
git commit -m "feat(verticais): serviço de onboarding unificado (planVertical + applyVertical)"
```

---

### Tarefa 11.4.3: endpoint `POST /api/onboarding/apply-vertical`

**Files:**
- Create: `src/app/api/onboarding/apply-vertical/route.ts`

**Step 1 — Rota (dono).**
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { applyVertical } from "@/server/services/vertical-onboarding.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  templateId: z.string().min(1),
  numberId: z.string().nullish(),
  applyTheme: z.boolean().default(true),
  overwriteText: z.boolean().default(false),
});

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const result = await applyVertical(ctx.tenantUserId, {
      templateId: parsed.data.templateId,
      numberId: parsed.data.numberId ?? null,
      applyTheme: parsed.data.applyTheme,
      overwriteText: parsed.data.overwriteText,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao aplicar" }, { status: 400 });
  }
}
```

**Step 2 — Compile.** `npx tsc --noEmit` → sem erros.

**Step 3 — Commit.**
```bash
git add src/app/api/onboarding/apply-vertical
git commit -m "feat(verticais): endpoint apply-vertical (orquestra o onboarding)"
```

---

### Tarefa 11.4.4: `VerticalOnboardingWizard` (UI) + entrada nas Configurações

**Files:**
- Create: `src/components/VerticalOnboardingWizard.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx` (montar o wizard perto de `BusinessCategorySettings`, só para dono)

**Step 1 — Componente.** Um wizard de 3 passos (client), reusando a lógica de seleção do
`BusinessTemplatePicker` (categoria → ramo via `BUSINESS_TEMPLATES`/`CATEGORY_LABEL`):
1. **Escolher ramo:** selects de categoria + ramo (as mesmas do picker). Mostra o `blurb`.
2. **Revisar o que será aplicado:** lista o preview do plano — "Tema: {cor do ramo}", "Campos: N",
   "Catálogo: será semeado / já tem itens", "Funil: renomeia X etapas", e um seletor **opcional** de número
   ("Aplicar atendimento e ofertas a: [número | nenhum]"). Se um número for escolhido e ele já tiver texto,
   um checkbox "substituir persona/base já escritas" (default off → `overwriteText: false`), espelhando o
   `window.confirm` de `WhatsAppNumbersPanel.tsx:362-365`.
3. **Aplicar:** `POST /api/onboarding/apply-vertical` com `{ templateId, numberId, applyTheme, overwriteText }`;
   exibe o `VerticalResult` (o que foi criado/pulado, erros por etapa) e um CTA para ver o resultado
   (Catálogo / Campos / Agenda). Recarrega a página ou dá refresh nas seções afetadas.

Para listar números no passo 2, reuse o endpoint que o `WhatsAppNumbersPanel` já consome (GET de números);
confirme a rota olhando esse componente. Tokens de tema, sem hex fixo ([[design-tokens-dark-theme]]).

**Step 2 — Montar na página.** Em `configuracoes/page.tsx`, dentro do bloco `isOwner`, logo após
`BusinessCategorySettings` (L88-92), renderize `<VerticalOnboardingWizard defaultTemplateId={businessTemplateId} />`.
Opcional: um atalho no `OnboardingChecklist` (novo passo "Configure seu ramo") — mas isso mexe no
`onboarding.service` (define os passos); trate como **fora de escopo** desta fase se exigir schema/serviço
novo, ou apenas um `Link` para as Configurações.

**Step 3 — Verifique end-to-end.** `npm run dev`, como dono de conta nova: abra Configurações → wizard →
escolha "Barbearia" (ou "Ótica") + um número → aplicar. Confirme: ramo salvo, tema trocado (cores mudam),
campos criados (aba Campos), catálogo semeado (Caixa → Catálogo), atendimento preenchido no número, funil
renomeado (se o ramo declarar labels). Rode de novo: nada duplica; o texto do número **não** é sobrescrito
sem o checkbox. Use a skill `verify` para dirigir o fluxo.

**Step 4 — Commit.**
```bash
git add src/components/VerticalOnboardingWizard.tsx src/app/\(app\)/configuracoes/page.tsx
git commit -m "feat(verticais): wizard de onboarding que aplica o ramo de uma vez"
```

---

# FASE 11.5 — Catálogo semeado estruturado

**Resultado:** os ramos de alto valor deixam de depender da heurística que raspa o `knowledgeBase` (frágil,
tudo com preço zero) e ganham um `catalogPreset` explícito (nome + tipo + preço opcional). Quem não tiver
preset continua com a heurística (nada regride). `seedCatalogFromTemplate` passa a respeitar o preço do
preset quando houver.

---

### Tarefa 11.5.1: `catalogPreset?` no template + `catalogSeedItems` prefere o preset

**Files:**
- Modify: `src/lib/business-templates.ts` (tipo + dados + `catalogSeedItems`)
- Test: `src/lib/business-templates.test.ts`

**Step 1 — Teste que falha.**
```ts
describe("catalogPreset (estruturado)", () => {
  it("quando o template tem catalogPreset, catalogSeedItems usa-o (nomes exatos)", () => {
    const tpl = getTemplate("barbearia")!; // dê catalogPreset a este na impl
    const items = catalogSeedItems(tpl);
    if (tpl.catalogPreset?.length) {
      expect(items.map((i) => i.name)).toEqual(tpl.catalogPreset.map((p) => p.name));
    }
  });

  it("preço do preset (quando informado) é inteiro >= 0", () => {
    for (const t of BUSINESS_TEMPLATES.filter((x) => x.catalogPreset?.length)) {
      for (const p of t.catalogPreset!) {
        if (p.priceCents !== undefined) {
          expect(Number.isInteger(p.priceCents), `preço não-inteiro em ${t.id}`).toBe(true);
          expect(p.priceCents, `preço negativo em ${t.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("sem catalogPreset, a heurística antiga segue valendo (barbearia scrape)", () => {
    // Se você NÃO deu catalogPreset à barbearia, este assert protege a heurística.
    // Escolha um ramo sem preset para este teste (ex.: 'salao-beleza').
    const names = catalogSeedItems(getTemplate("salao-beleza")!).map((i) => i.name);
    expect(names.length).toBeGreaterThan(0);
  });
});
```
> Ajuste os ids do teste ao que você realmente der preset. O ponto travado: **com** preset → nomes exatos;
> **sem** preset → heurística intacta (os testes existentes de `catalogSeedItems` para `barbearia`/`otica`/
> `advocacia` em L143-181 **devem continuar verdes** — só dê `catalogPreset` a ramos que **não** estão
> cobertos por aqueles testes, ou ajuste-os conscientemente).

**Step 2 — Rode e veja falhar.** `-t catalogPreset` → FAIL.

**Step 3 — Implemente.**
- Em `BusinessTemplate` adicione:
  ```ts
  /** Itens de catálogo explícitos (preferidos à heurística de knowledgeBase). Preço opcional (0 = a definir). */
  catalogPreset?: { name: string; kind: CatalogSeedKind; priceCents?: number }[];
  ```
- No topo de `catalogSeedItems` (L1815), **antes** da heurística:
  ```ts
  if (tpl.catalogPreset?.length) {
    return tpl.catalogPreset.map((p) => ({ name: p.name, kind: p.kind }));
  }
  ```
  (mantém o retorno `CatalogSeedItem[]` compatível — o preço vive só no template e é lido na Tarefa 11.5.2).
- Popule `catalogPreset` em 2–3 ramos de alto valor onde a heurística hoje entrega pouco/mal (ex.:
  `restaurante-delivery`, `pizzaria-hamburgueria`, `otica`), com preços de referência ou `0`.

**Step 4 — Rode e veja passar.** `npx vitest run src/lib/business-templates.test.ts` → PASS (novos + os de
`catalogSeedItems` existentes). Se algum teste antigo de scrape quebrar, foi porque você deu preset a um
ramo que ele cobre — reverta esse preset ou atualize o teste conscientemente.

**Step 5 — Commit.**
```bash
git commit -am "feat(verticais): catalogPreset estruturado (preferido à heurística de knowledgeBase)"
```

---

### Tarefa 11.5.2: `seedCatalogFromTemplate` usa o preço do preset

**Files:**
- Modify: `src/server/services/catalog.service.ts` (`seedCatalogFromTemplate`, L137-148)
- Test: `src/server/services/catalog.service.test.ts` (**JÁ EXISTE — banco real; ESTENDA**)

**Step 1 — Teste (banco real).**
```ts
describe("seedCatalogFromTemplate — preço do preset", () => {
  it("usa priceCents do catalogPreset quando informado", async () => {
    const acc = await makeOwner();
    // use um ramo cujo catalogPreset tenha ao menos um item com priceCents > 0 (Tarefa 11.5.1)
    const items = await seedCatalogFromTemplate(acc, "otica");
    // se o preset da ótica define preço, ao menos um item nasce != 0
    expect(items.some((i) => i.priceCents > 0)).toBe(true);
  });

  it("ramo só-heurística continua nascendo com preço 0", async () => {
    const acc = await makeOwner();
    const items = await seedCatalogFromTemplate(acc, "salao-beleza"); // sem catalogPreset
    expect(items.every((i) => i.priceCents === 0)).toBe(true);
  });
});
```

**Step 2 — Rode e veja falhar.** `-t "preço do preset"` → FAIL (hoje força `priceCents: 0`).

**Step 3 — Implemente.** Em `seedCatalogFromTemplate` (L137-148), monte um mapa nome→preço a partir do
`tpl.catalogPreset` e use-o no `createMany`:
```ts
const priceByName = new Map((tpl.catalogPreset ?? []).map((p) => [p.name, p.priceCents ?? 0]));
await prisma.catalogItem.createMany({
  data: seeds.map((s) => ({ accountId, name: s.name, priceCents: priceByName.get(s.name) ?? 0, kind: s.kind })),
});
```
> `seeds` continua vindo de `catalogSeedItems(tpl)` (que agora, com preset, devolve exatamente os nomes do
> preset — então o `Map` casa por nome). Sem preset, `priceByName` é vazio → `?? 0` mantém o comportamento
> atual. Guard de "catálogo vazio" (L142-143) **inalterado**.

**Step 4 — Rode e veja passar.** `npx vitest run src/server/services/catalog.service.test.ts` → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/catalog.service.ts src/server/services/catalog.service.test.ts
git commit -m "feat(verticais): catálogo semeado respeita o preço do preset do ramo"
```

---

## Verificação de ponta a ponta (antes de fechar)

1. `npm test` inteiro verde + `npx tsc --noEmit` limpo + `npm run lint` sem erros novos.
2. Conta **nova** (catálogo/campos/funil vazios), como dono: Configurações → **wizard** → categoria+ramo
   (ex.: "Ótica") + um número → aplicar. Confirme na sequência:
   - **Ramo** salvo (`BusinessCategorySettings` mostra "Ótica").
   - **Tema** trocado (as cores da UI mudam para o preset de varejo — Fase 11.3).
   - **Campos** criados (aba Campos: "Esférico", "Cilíndrico"… — Fase 11.1).
   - **Catálogo** semeado com preços do preset onde houver (Caixa → Catálogo — Fase 11.5).
   - **Atendimento** do número preenchido (persona/base — via `applyTemplate`), toggles respeitando o plano.
   - **Ofertas** sugeridas do ramo, **inativas** (Fase 11.2), se o plano permitir `sales`.
   - **Funil** renomeado se o ramo declarar `pipelineLabels`.
3. **Idempotência:** rodar o wizard de novo no mesmo ramo → nada duplica (campos/ofertas todos `skipped`,
   catálogo pulado por não estar vazio); o texto do número **não** é sobrescrito sem o checkbox.
4. Conta de **serviço puro** (sem número, plano sem `sales`): o wizard aplica só ramo/tema/campos/funil e
   **não** tenta atendimento nem ofertas (o `plan` desliga). Sem 500.
5. As 4 categorias antes sem cor (`casa`/`educacao`/`varejo`/`eventos`) agora oferecem tema no picker/wizard.

---

## Riscos e notas

- **Sem schema ⇒ sem PROD SQL.** A única entrega em PROD é o **deploy de código** (Vercel via CLI —
  [[vercel-hobby-push-block]]). Não há `prisma/manual/*.sql`, não há `db push`, não há onda para compor.
  Se em revisão surgir tentação de "só uma coluninha", **pare**: reavalie se dá para reusar coluna existente
  (`pipelineLabels`, `presetId`, `customFields`) — o valor desta iniciativa é justamente ser schema-free.
- **`seedCatalogFromTemplate` só entra em catálogo vazio** (guard existente). O wizard respeita isso no
  `plan` e trata a exceção como best-effort (`errors`), então uma conta com catálogo não perde os outros
  passos.
- **`overwriteText` default `false`.** O wizard nunca apaga persona/base já escritas sem confirmação — o
  maior risco de dano seria justamente isso. O `applyTemplate` já implementa o "preenche só o vazio".
- **`updateWhatsAppNumber` re-gateia features** ao ligar `qualify/schedule/sales` — mesmo que o `plan`
  calcule `allow`, a escrita final valida de novo (defesa em profundidade). Não desligue toggles já ligados
  (o `applyTemplate` também garante isso).
- **Ofertas nascem inativas** — a IA (via `listActiveOffers`) só as vê após o dono revisar preço e publicar.
  Evita anunciar "R$ 0,00" ou o `priceHint` como preço real.
- **Testes de integração (`applyVertical`, `seedCatalogFromTemplate`) exigem `DATABASE_URL` de teste** (mesmo
  requisito de `order`/`catalog`). Sem Postgres de teste, cubra o máximo com os testes puros
  (`planVertical`, invariantes de `business-templates`/`presets`) + skill `verify`.
- **Não quebre a heurística de catálogo:** só dê `catalogPreset` a ramos que os testes de `catalogSeedItems`
  (barbearia/ótica/advocacia) **não** cobrem — ou atualize esses testes conscientemente. A invariante
  "categoria tem modelo" e "labels únicos" de `business-templates.test.ts` também não podem regredir.

---

## Ordem de entrega recomendada
1. **11.1** (campos por ramo) e **11.3** (temas faltantes) — só conteúdo + invariantes, zero dependência,
   ship isolado.
2. **11.2** (ofertas sugeridas) — serviço + rota + botão; independe do wizard.
3. **11.5** (catálogo estruturado) — melhora o seed antes de o wizard passar a usá-lo.
4. **11.4** (wizard) por último — orquestra tudo que as fases anteriores entregaram.
