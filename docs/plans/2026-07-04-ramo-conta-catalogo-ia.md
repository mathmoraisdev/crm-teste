# Ramo do negócio (nível conta) + Catálogo na IA — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar à conta um **ramo de negócio** canônico (definido uma vez em Configurações) que (1) pré-seleciona o modelo de Atendimento de cada número, (2) **oferece** semear o catálogo do ramo (sem sobrescrever), e (3) faz o **catálogo estruturado alimentar a IA de atendimento** — para a IA conhecer os serviços/produtos e responder "quais lanches vocês têm?" sem PDF nem OCR.

**Architecture:** Um campo `businessTemplateId` no `User` (dono/tenant) vira a **fonte de verdade única** do ramo — hoje a vertical só existe, volátil, dentro da config de cada número. A partir dele: o `BusinessTemplatePicker` do número ganha pré-seleção; o estado-vazio do Catálogo destaca "usar o modelo do seu ramo"; e um renderizador puro (`renderCatalogForAI`, irmão do `renderActiveOffers` que já existe) injeta os itens ativos do catálogo no contexto de `generateAttendanceReply`. Catálogo é **por conta** (`accountId = lead.userId`); as `Offer` (funil Pix) continuam por número — são coisas separadas e complementares.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma + Postgres · Zod · TailwindCSS · Vitest (`*.test.ts` co-locado).

**Decisões de produto já tomadas (do dono):**
- **Seed é OFERECIDO, não silencioso** — ao ter ramo definido, o Catálogo mostra um botão "Usar o modelo do seu ramo (X)"; nunca preenche sozinho.
- **Nunca sobrescreve** — trocar o ramo muda a sugestão da IA/Atendimento, mas **não mexe** no catálogo já editado. Seed só roda em catálogo vazio (garantia já existente em `seedCatalogFromTemplate`).
- **Ramo sem itens concretos** (advocacia, revenda, atacado, genérico) → cai no cadastro manual, sem item de mentira (comportamento atual de `catalogSeedItems`).
- **Catálogo → IA:** injeta itens ATIVOS; preço só quando > 0 (item semeado nasce em 0 = "sob consulta"); teto de itens p/ não estourar token.

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest, co-locado (`foo.ts` → `foo.test.ts`). Um específico: `npx vitest run caminho/arquivo.test.ts`. Testes de service que tocam Prisma usam o **banco de dev** (o Prisma v6 carrega `.env` sob vitest; padrão já usado por `catalog.service.test.ts`). Testes de função pura não tocam banco.
- **Schema:** dev usa `npx prisma db push`. **Produção** tem cutover pendente p/ `migrate deploy` — cada mudança de schema ganha um SQL manual idempotente em `prisma/manual/` (padrão de `prisma/manual/2026-07-03-vendas.sql`), aplicado no Supabase SQL Editor de prod pelo dono. **Em prod o role da app é `postgres`** (não existe `crm`) — colunas novas nascem com owner postgres, **sem GRANT**.
- **⚠️ Windows/Prisma:** `prisma db push`/`generate` falha com EPERM se o `next dev` estiver rodando (segura a DLL do query-engine). **Pare o dev server antes** de mexer no schema, rode `generate`, reinicie depois. (memória `prisma-generate-dev-server-lock`)
- **Dinheiro:** SEMPRE centavos (`Int`). `formatCentsBRL` só na borda. Nunca float.
- **Tenancy:** dono = `ctx.tenantUserId` (via `getTenantContext()`). Todo dado escopado por `accountId = tenantUserId`. `businessTemplateId` só faz sentido no dono (`ownerId = null`).
- **Rotas de API:** espelhe `src/app/api/account/pipeline-labels/route.ts` — `dynamic="force-dynamic"`, `getTenantContext()`, 401 sem sessão, 403 sem `perms.canSettings`, zod no body, `try/catch → { error }` legível (nunca 500 de corpo vazio).
- **Commits frequentes** ao fim de cada task.

**Pontos-chave já mapeados no código (não re-descobrir):**
- Modelos de negócio: `src/lib/business-templates.ts` — `BUSINESS_TEMPLATES`, `CATEGORY_LABEL`, `getTemplate(id)`, `catalogSeedItems(tpl)`.
- Semeadura já pronta: `seedCatalogFromTemplate(accountId, templateId)` em `src/server/services/catalog.service.ts` (não-destrutiva; recusa catálogo não-vazio e ramo sem itens).
- Contexto da IA de atendimento: `buildAttendanceContext` + `renderActiveOffers` em `src/server/ai/attendance-context.ts`; consumidos em `generateAttendanceReply` (`src/server/ai/conversation.agent.ts:85`).
- Call sites da resposta: `src/server/services/conversation.service.ts:596` (auto-resposta) e `:663` (`suggestAttendanceReply`, rascunho ao operador). Ambos têm `lead.userId` (o dono/accountId).
- Picker do número: `BusinessTemplatePicker` (`src/components/BusinessTemplatePicker.tsx`) usado só em `WhatsAppNumbersPanel.tsx:698` (modal "Atendimento — <empresa>").
- Config da conta (padrão a espelhar): `getPipelineLabels`/`setPipelineLabels` em `src/server/services/account.service.ts` + rota `pipeline-labels` + UI `PipelineLabelsManager`.

---

## Visão geral das fases

- **Fase 0** — Schema: `User.businessTemplateId` + push dev + SQL manual de prod.
- **Fase 1** — Ramo da conta: service (TDD) + API + card "Meu negócio" em Configurações.
- **Fase 2** — Pré-seleção do modelo no Atendimento (picker aceita default + painel passa o ramo).
- **Fase 3** — Estado-vazio do Catálogo destaca "usar o modelo do seu ramo".
- **Fase 4** — Opção A: catálogo estruturado → contexto da IA (renderizador puro TDD + fiação nos 2 call sites).
- **Fase 5** — Verificação E2E + fechamento.

Cada fase é entregável e reversível de forma independente.

---

# FASE 0 — Schema

## Task 0.1: Campo `businessTemplateId` no User

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, perto de `plan Plan?`)

**Step 1:** No `model User`, junto do campo `plan` (contexto "comercial do dono"), adicione:

```prisma
  // Ramo do negócio da conta (id de BUSINESS_TEMPLATES, ex.: "barbearia"). Fonte
  // de verdade da vertical no NÍVEL CONTA — pré-seleciona o modelo de Atendimento
  // dos números e habilita semear o catálogo. Só faz sentido no dono (ownerId=null).
  businessTemplateId String?
```

**Step 2: Aplicar no banco de dev** (pare o `next dev` antes — ver convenções)

Run: `npx prisma db push`
Expected: "Your database is now in sync". Depois `npx prisma generate` (se o generate falhar com EPERM, mate os processos `next dev` e rode de novo).

Run: `npx tsc --noEmit`
Expected: sem erros novos.

**Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ramo): campo User.businessTemplateId (ramo do negócio por conta)"
```

---

## Task 0.2: SQL manual para produção

**Files:**
- Create: `prisma/manual/2026-07-04-user-business-template.sql`

Confira o DDL exato:

Run: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` e localize a linha do `ADD COLUMN "businessTemplateId"` (ou gere só a coluna). O conteúdo esperado:

```sql
-- Adiciona User.businessTemplateId (ramo do negócio por conta).
-- Aplicar em PROD manualmente (Supabase SQL Editor). Idempotente e ADITIVO.
-- Coluna nullable → não quebra linhas existentes. Em prod o app conecta como
-- `postgres` (owner), então NÃO precisa GRANT.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessTemplateId" TEXT;
```

> **Importante:** confira que o tipo bate com o gerado pelo Prisma (`TEXT`, nullable). Se divergir, o do Prisma é a fonte de verdade.

**Step 2: Commit** (aplicação em prod é manual pelo dono)

```bash
git add prisma/manual/2026-07-04-user-business-template.sql
git commit -m "chore(db): SQL manual de User.businessTemplateId (aplicação manual em prod)"
```

> **Nota de produção (para o dono aplicar):** rode o SQL no Supabase de prod **antes** de deployar o código desta feature (o Prisma vai fazer `select` da coluna nova — sem ela, quebra). Validar: `select column_name from information_schema.columns where table_name='User' and column_name='businessTemplateId';`.

---

# FASE 1 — Ramo da conta (service + API + UI)

## Task 1.1: Service do ramo da conta (com teste)

**Files:**
- Modify: `src/server/services/account.service.ts` (adicionar 2 funções)
- Test: `src/server/services/account.business.test.ts`

Regras: `getBusinessTemplateId(userId)` devolve o id salvo (ou null). `setBusinessTemplateId(userId, id)` valida que `id` é `null` OU existe em `BUSINESS_TEMPLATES` (via `getTemplate`), e salva. Escopo por dono. Rejeita id inexistente.

**Step 1: Teste que falha** (`account.business.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { getBusinessTemplateId, setBusinessTemplateId } from "./account.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `biz_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("account business template", () => {
  it("começa null e persiste um id válido", async () => {
    const a = await makeOwner();
    expect(await getBusinessTemplateId(a)).toBeNull();
    await setBusinessTemplateId(a, "barbearia");
    expect(await getBusinessTemplateId(a)).toBe("barbearia");
  });

  it("aceita null (limpar) e rejeita id inexistente", async () => {
    const a = await makeOwner();
    await setBusinessTemplateId(a, "barbearia");
    await setBusinessTemplateId(a, null);
    expect(await getBusinessTemplateId(a)).toBeNull();
    await expect(setBusinessTemplateId(a, "nao-existe")).rejects.toThrow();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/account.business.test.ts`
Expected: FAIL — funções inexistentes.

**Step 3: Implementar** (adicione ao fim de `account.service.ts`):

```ts
import { getTemplate } from "@/lib/business-templates";

/** Ramo do negócio da conta (id de BUSINESS_TEMPLATES) ou null. Escopo: dono. */
export async function getBusinessTemplateId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { businessTemplateId: true } });
  return u?.businessTemplateId ?? null;
}

/** Define/limpa o ramo. Valida contra BUSINESS_TEMPLATES (null = limpar). */
export async function setBusinessTemplateId(userId: string, templateId: string | null): Promise<void> {
  if (templateId !== null && !getTemplate(templateId)) throw new Error("Ramo inválido.");
  await prisma.user.update({ where: { id: userId }, data: { businessTemplateId: templateId } });
}
```

> Confira se `prisma` já está importado no topo de `account.service.ts` (deve estar). Reuse o import existente.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/account.business.test.ts`
Expected: PASS (2 testes).

**Step 5: Commit**

```bash
git add src/server/services/account.service.ts src/server/services/account.business.test.ts
git commit -m "feat(ramo): get/set do ramo do negócio da conta (validado)"
```

---

## Task 1.2: API do ramo da conta

**Files:**
- Create: `src/app/api/account/business/route.ts` (GET lê, PUT define)

**Step 1:** `route.ts` (espelha `pipeline-labels/route.ts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId, setBusinessTemplateId } from "@/server/services/account.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ businessTemplateId: await getBusinessTemplateId(ctx.tenantUserId) });
}

const putSchema = z.object({ businessTemplateId: z.string().nullable() });

export async function PUT(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    await setBusinessTemplateId(ctx.tenantUserId, parsed.data.businessTemplateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/account/business
git commit -m "feat(ramo): API GET/PUT do ramo do negócio da conta"
```

---

## Task 1.3: UI — card "Meu negócio" em Configurações

**Files:**
- Create: `src/components/app/BusinessCategorySettings.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx` (montar o card; passar `canSettings` e o valor inicial)

Client component: um `<select>` agrupado por categoria (só ramos existentes) com o ramo atual selecionado; salva via PUT. Padrão visual de `PipelineLabelsManager` / `Card`/`Button`. Desabilitado sem `canEdit`.

**Step 1: Componente** (esboço — use `Card`/`CardHeader`/`Button` e `BUSINESS_TEMPLATES`/`CATEGORY_LABEL`):

```tsx
"use client";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BUSINESS_TEMPLATES, CATEGORY_LABEL, type BusinessCategory } from "@/lib/business-templates";

const GROUPS = (Object.keys(CATEGORY_LABEL) as BusinessCategory[])
  .map((c) => ({ category: c, label: CATEGORY_LABEL[c], templates: BUSINESS_TEMPLATES.filter((t) => t.category === c) }))
  .filter((g) => g.templates.length > 0);

export function BusinessCategorySettings({ canEdit, initial }: { canEdit: boolean; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/account/business", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessTemplateId: value || null }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "Erro"); }
      setMsg("Salvo.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }
  return (
    <Card>
      <CardHeader title="Meu negócio" subtitle="Seu ramo pré-configura o atendimento da IA e sugere um catálogo pronto." />
      {/* <select> agrupado (optgroup por g.label) + <option value=""> Não definido; botão Salvar disabled se !canEdit */}
    </Card>
  );
}
```

**Step 2: Montar em Configurações.** Em `configuracoes/page.tsx`, importe o componente e busque o valor inicial (server-side) com `getBusinessTemplateId(ctx.tenantUserId)`; adicione `<BusinessCategorySettings canEdit={ctx.perms.canSettings} initial={businessTemplateId} />` junto dos outros cards de conta.

**Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/components/app/BusinessCategorySettings.tsx "src/app/(app)/configuracoes/page.tsx"
git commit -m "feat(ramo): card 'Meu negócio' em Configurações"
```

---

# FASE 2 — Pré-seleção do modelo no Atendimento

## Task 2.1: Picker aceita modelo pré-selecionado

**Files:**
- Modify: `src/components/BusinessTemplatePicker.tsx`

**Step 1:** Adicione uma prop opcional `defaultTemplateId?: string | null` e inicialize `cat`/`tplId` a partir dela (via `getTemplate`), preservando o comportamento atual quando ausente.

```tsx
export function BusinessTemplatePicker({
  onApply,
  defaultTemplateId,
}: {
  onApply: (tpl: BusinessTemplate) => void;
  defaultTemplateId?: string | null;
}) {
  const initial = defaultTemplateId ? getTemplate(defaultTemplateId) : undefined;
  const [cat, setCat] = useState<BusinessCategory | "">(initial?.category ?? "");
  const [tplId, setTplId] = useState(initial?.id ?? "");
  // ... resto igual (importe getTemplate de @/lib/business-templates)
```

**Step 2: Verificar** — sem `defaultTemplateId`, nada muda (compatível). `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/BusinessTemplatePicker.tsx
git commit -m "feat(ramo): BusinessTemplatePicker aceita modelo pré-selecionado"
```

---

## Task 2.2: Painel do número passa o ramo da conta

**Files:**
- Modify: `src/components/WhatsAppNumbersPanel.tsx` (buscar o ramo da conta e passar ao picker em `:698`)

**Step 1:** Carregue o ramo da conta (GET `/api/account/business`) uma vez no painel (estado `accountBusinessId`), e passe `<BusinessTemplatePicker onApply={handleApplyTemplate} defaultTemplateId={accountBusinessId} />`.

**Step 2: Verificar** — o modal "Atendimento" agora abre com o modelo do ramo já selecionado (dono só confirma). Sem ramo, comportamento atual. `npx tsc --noEmit` limpo.

**Step 3: Commit**

```bash
git add src/components/WhatsAppNumbersPanel.tsx
git commit -m "feat(ramo): Atendimento pré-seleciona o modelo do ramo da conta"
```

---

# FASE 3 — Estado-vazio do Catálogo destaca o ramo

## Task 3.1: "Usar o modelo do seu ramo (X)"

**Files:**
- Modify: `src/components/vendas/CatalogManager.tsx` (nova prop `accountBusinessId`)
- Modify: `src/components/vendas/VendasWorkspace.tsx` (repassar a prop)
- Modify: `src/app/(app)/vendas/page.tsx` (buscar `getBusinessTemplateId` e passar)

Quando a conta tem ramo definido **e** ele gera itens (`catalogSeedItems(getTemplate(id)).length > 0`), o estado-vazio mostra um **botão primário** "Usar o modelo do seu ramo (<label>)" que chama o mesmo `POST /api/vendas/catalog/seed` com esse `templateId`. O dropdown completo continua embaixo como alternativa ("outro ramo").

**Step 1:** Em `page.tsx`, `const businessTemplateId = await getBusinessTemplateId(ctx.tenantUserId);` e passe por `VendasWorkspace` → `CatalogManager`.

**Step 2:** Em `CatalogManager`, no bloco de estado-vazio (hoje "Comece rápido pelo seu ramo"), se `accountBusinessId` resolve p/ um template com itens, renderize primeiro o atalho de 1 clique (reusa a função `seedFromTemplate` já existente, passando o id do ramo). Mantenha o `<select>` como fallback.

**Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/components/vendas/CatalogManager.tsx src/components/vendas/VendasWorkspace.tsx "src/app/(app)/vendas/page.tsx"
git commit -m "feat(ramo): catálogo vazio oferece o modelo do ramo da conta em 1 clique"
```

---

# FASE 4 — Opção A: catálogo estruturado → contexto da IA

## Task 4.1: Renderizador puro `renderCatalogForAI` (com teste)

**Files:**
- Modify: `src/server/ai/attendance-context.ts` (adicionar renderizador + tipo)
- Test: `src/server/ai/attendance-context.test.ts` (arquivo já existe — adicionar casos)

Regras (PURA, sem banco): recebe itens ativos `{ name, priceCents, kind }`; monta um bloco "SERVIÇOS E PRODUTOS". Preço só quando `> 0` (item semeado nasce em 0 → mostra "sob consulta"). String vazia quando não há itens (o chamador omite). Teto de `limit` (default 40) p/ não estourar token.

**Step 1: Teste que falha** (adicione ao `attendance-context.test.ts`):

```ts
import { renderCatalogForAI } from "./attendance-context";

describe("renderCatalogForAI", () => {
  it("lista itens com preço; zero vira 'sob consulta'", () => {
    const out = renderCatalogForAI([
      { name: "X-Burguer", priceCents: 2500, kind: "PRODUTO" },
      { name: "Corte", priceCents: 0, kind: "SERVICO" },
    ]);
    expect(out).toContain("X-Burguer");
    expect(out).toContain("R$ 25,00");
    expect(out).toContain("Corte");
    expect(out).toMatch(/Corte.*sob consulta/);
  });
  it("vazio → string vazia", () => {
    expect(renderCatalogForAI([])).toBe("");
  });
  it("respeita o teto de itens", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}`, priceCents: 100, kind: "PRODUTO" as const }));
    const out = renderCatalogForAI(many, 40);
    expect(out.split("\n").filter((l) => l.startsWith("- ")).length).toBe(40);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/ai/attendance-context.test.ts`
Expected: FAIL — `renderCatalogForAI` inexistente.

**Step 3: Implementar** (em `attendance-context.ts`, ao lado de `renderActiveOffers`):

```ts
export interface CatalogItemForContext {
  name: string;
  priceCents: number;
  kind: "SERVICO" | "PRODUTO";
}

/**
 * Renderiza (PURA) o catálogo ativo da conta como bloco de contexto — para a IA
 * conhecer serviços/produtos e responder dúvidas. Preço só quando > 0 (item sem
 * preço definido = "sob consulta"). Vazio quando não há itens (chamador omite).
 */
export function renderCatalogForAI(items: CatalogItemForContext[], limit = 40): string {
  if (!items.length) return "";
  const lines = items.slice(0, limit).map((i) => {
    const price = i.priceCents > 0 ? formatCentsBRL(i.priceCents) : "sob consulta";
    return `- ${i.name}: ${price}`;
  });
  return `SERVIÇOS E PRODUTOS (catálogo da empresa; informe preço só se listado):\n${lines.join("\n")}`;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/ai/attendance-context.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/ai/attendance-context.ts src/server/ai/attendance-context.test.ts
git commit -m "feat(ia): renderCatalogForAI — catálogo ativo como bloco de contexto"
```

---

## Task 4.2: `generateAttendanceReply` aceita o bloco de catálogo

**Files:**
- Modify: `src/server/ai/conversation.agent.ts` (`generateAttendanceReply`)

**Step 1:** Adicione `catalogBlock?: string` às `opts` e inclua no `prefix` (depois do contexto/instruções, antes da conversa). Como o `override` (system prompt avançado) ignora o contexto, o catálogo **também** só entra quando não há override:

```ts
export async function generateAttendanceReply(opts: {
  ai: AiClient;
  company: { /* ...campos atuais... */ };
  catalogBlock?: string;
  conversation: ConversationTurn[];
}): Promise<string> {
  const override = opts.company.systemPromptOverride?.trim();
  const system = override || ATTENDANCE_SYSTEM;
  const context = override ? "" : buildAttendanceContext(opts.company);
  const catalog = !override && opts.catalogBlock ? `\n\n${opts.catalogBlock}` : "";
  const extra =
    !override && opts.company.customInstructions
      ? `\n\nInstruções adicionais da empresa:\n${opts.company.customInstructions}`
      : "";
  const prefix = context || catalog || extra ? `${context}${catalog}${extra}\n\n` : "";
  // ...resto igual
}
```

**Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros (nenhum chamador precisa passar `catalogBlock` ainda — é opcional).

**Step 3: Commit**

```bash
git add src/server/ai/conversation.agent.ts
git commit -m "feat(ia): generateAttendanceReply aceita bloco de catálogo (opcional)"
```

---

## Task 4.3: Fiação — buscar o catálogo e passar nos 2 call sites

**Files:**
- Modify: `src/server/services/conversation.service.ts` (`:596` auto-resposta e `:663` `suggestAttendanceReply`)

Um helper local carrega o catálogo ativo da conta e renderiza. Reusa `listCatalogItems` (já existe, com `activeOnly`) e `renderCatalogForAI`.

**Step 1:** No topo, importe:

```ts
import { renderCatalogForAI } from "@/server/ai/attendance-context";
import { listCatalogItems } from "@/server/services/catalog.service";
```

E um helper (perto dos outros helpers do arquivo):

```ts
/** Bloco de catálogo ativo da conta p/ o contexto da IA (vazio se não há itens). */
async function loadCatalogBlock(accountId: string): Promise<string | undefined> {
  const items = await listCatalogItems(accountId, { activeOnly: true });
  const block = renderCatalogForAI(items.map((i) => ({ name: i.name, priceCents: i.priceCents, kind: i.kind })));
  return block || undefined;
}
```

**Step 2:** No call site da **auto-resposta** (`:596`), antes do `generateAttendanceReply`, carregue `const catalogBlock = await loadCatalogBlock(lead.userId);` e passe `catalogBlock` no objeto de opts.

**Step 3:** No `suggestAttendanceReply` (`:663`), idem: `const catalogBlock = await loadCatalogBlock(lead.userId);` e passe no opts do `return generateAttendanceReply({ ... , catalogBlock, ... })`.

> **Escopo:** `lead.userId` é o dono (accountId). O catálogo é por conta, então o mesmo bloco vale para qualquer número daquela conta. Sem itens → `undefined` → nada injetado (sem regressão).

**Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npx vitest run` (garantir que os testes de conversation.service seguem verdes).

**Step 5: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(ia): injeta catálogo da conta no contexto de atendimento (auto + sugestão)"
```

---

# FASE 5 — Verificação end-to-end e fechamento

## Task 5.1: Verificação (skill @verify)

**Checklist automatizado:**
- [ ] `npx vitest run` — tudo verde.
- [ ] `npx tsc --noEmit` — limpo.

**Checklist E2E manual/autenticado** (padrão dos E2E autenticados via cookie de sessão assinado — `signSession` + `SESSION_COOKIE`, mesmos usados nos E2E de vendas):
- [ ] **Configurações → Meu negócio:** definir "Barbearia"; recarregar mostra selecionado; `GET /api/account/business` retorna `barbearia`.
- [ ] **Atendimento:** abrir o modal de um número → o `BusinessTemplatePicker` já vem com Barbearia selecionada.
- [ ] **Catálogo vazio:** a aba mostra "Usar o modelo do seu ramo (Barbearia)"; 1 clique semeia os itens (preço 0). Não-destrutivo: com catálogo não-vazio o atalho/seed não sobrescreve (endpoint retorna 400 no seed).
- [ ] **Trocar o ramo** depois NÃO altera o catálogo já cadastrado.
- [ ] **IA conhece o catálogo:** unit/integration — chamar `generateAttendanceReply` (ou `suggestAttendanceReply`) com uma conta que tem itens ativos e verificar que o prompt/os itens entram no contexto (via `renderCatalogForAI`). Opcional: teste que confirma `loadCatalogBlock` retorna bloco com os nomes.
- [ ] **Permissão:** operador sem `canSettings` não altera o ramo (`PUT /api/account/business` → 403) nem semeia catálogo (já coberto).

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde. `npx tsc --noEmit` — limpo.
- [ ] Ramo só no dono; nenhuma query cruza tenant.
- [ ] Catálogo → IA é aditivo e degradável (sem itens = sem bloco).
- [ ] Dinheiro sempre em centavos; preço 0 = "sob consulta" no contexto da IA.

**Notas de produção (para o dono aplicar):**
- Aplicar `prisma/manual/2026-07-04-user-business-template.sql` no Supabase de **prod** ANTES de deployar o código (o Prisma faz `select` da coluna nova). Validar com o `information_schema.columns` acima.
- Deploy pela CLI da Vercel (bypassa o "Blocked" do Git integration — memória `vercel-hobby-push-block`): `env -u CLAUDECODE CI=1 VERCEL_TOKEN=<token> npx vercel deploy --prod --yes`.

**Fora de escopo (v3, sob demanda):**
- **Opção C — IA envia o cardápio (PDF):** storage de arquivo por conta/número + tool no agente ("enviar cardápio") + gatilho. Reusa `documentMessage`/`send-file`. Média complexidade.
- **Opção B — importar PDF → knowledgeBase (OCR):** descartada por custo/fragilidade; a Opção A (catálogo estruturado → IA) já resolve "a IA conhece o cardápio" sem PDF.
- Persistir a vertical **por número** (multi-vertical fino) — hoje o ramo é único por conta, suficiente para o público-alvo.
