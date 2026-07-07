# Reorganização da navegação / IA do dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 14 — sem onda de schema).

**Goal:** reorganizar a navegação do dashboard para que qualquer pessoa entenda todas as
funcionalidades: um sidebar que espelha a rotina do dono do negócio, a configuração de cada módulo
movida para dentro do próprio módulo, e o menu que se adapta ao ramo — tudo sem esconder nada de forma
irreversível.

**Architecture:** a navegação vira **dado testável**. Hoje o array de grupos está hardcoded dentro de
`Sidebar.tsx`; extraímos para uma **função pura** `buildNav(ctx)` (`src/lib/nav.ts`) que recebe papel +
categoria do ramo + flags e devolve os grupos. O `Sidebar` só renderiza. A adaptação por ramo é uma
**predicate pura** `moduleVisibleFor(category, moduleKey)`; módulos irrelevantes ao ramo caem num grupo
colapsável "Mais", **nunca somem** (sem risco de prender o usuário → **zero schema novo**). A config de
módulo é **relocada** dos ~14 blocos de `configuracoes/page.tsx` para uma aba "Configurar" em cada
módulo (Agenda, Atendimento, Caixa) reaproveitando os componentes de settings que já existem.

**Tech Stack:** Next.js (App Router, RSC + client) · TailwindCSS · Vitest · lucide-react. **Sem Prisma/
schema** — é reorganização de front-end e roteamento.

**Escopo (o que NÃO entra):** redesenho visual do sidebar (mantém o estilo atual — [[design-tokens-dark-theme]]);
busca global/command-palette (melhoria futura); preferência persistida de "mostrar tudo" (v1 usa o grupo
"Mais" colapsável, sem campo no banco).

**Decisões de produto:**
- **Nada fica inacessível.** Gating por ramo só move módulos pouco usados para um grupo "Mais"
  colapsável — o usuário sempre alcança tudo.
- **Config perto do uso.** Cadastrar barbeiro fica na Agenda; respostas rápidas ficam no Atendimento;
  impressão/fiscal ficam no Caixa. `Configurações` guarda só o que é global (conta, marca, ramo, campos,
  funil, integrações/IA).
- **Fim das colisões de nome:** grupo "Operação" (não "Atendimento", que colidia com o item); o billing
  do SaaS vira "**Administração**" (era "Financeiro", que confundia com o financeiro do negócio).

---

## Contexto do código existente (leia antes de começar)

- **Sidebar:** [Sidebar.tsx:124-154](../../src/components/app/Sidebar.tsx#L124-L154) — array `navGroups`
  hardcoded (grupos Atendimento/Crescimento/Gestão), `.filter(show)`. Tipo `NavItem` (~L13-19), badges
  por polling (~L34-122). Recebe `isAdmin`/`isAccountAdmin`/`branding`.
- **Layout que monta o Sidebar:** `src/app/(app)/layout.tsx` — resolve `isAdmin`/`isAccountAdmin`/branding
  via `getTenantContext`; **passa a resolver também a categoria do ramo** (Task 3.2).
- **Ramo → categoria:** [business-templates.ts](../../src/lib/business-templates.ts) — `getTemplate(id)?.category`
  (`BusinessCategory`), `getBusinessTemplateId(accountId)` em `account.service.ts`.
- **Configurações (o depósito a esvaziar):** [configuracoes/page.tsx](../../src/app/(app)/configuracoes/page.tsx)
  importa e renderiza: `AccountSettings`, `CustomFieldsManager`, `PipelineLabelsManager`, `BrandingSettings`,
  `PosPrintSettings`, `BusinessCategorySettings`, `QuickRepliesSettings`, `InboxSlaSettings`,
  `ProfessionalsSettings`, `CommissionSettings`, `MediaLibrarySettings`, `BookingSettings`,
  `LifecycleSettings` + status fiscal.
- **Caixa (abas):** [VendasWorkspace.tsx:24-59](../../src/components/vendas/VendasWorkspace.tsx#L24-L59) —
  tabs comandas/catalogo/estoque/despesas/relatorios. Padrão de abas a reusar nos módulos.
- **Agenda:** `src/app/(app)/agenda/page.tsx` → `AgendaView.tsx`. **Inbox:** `InboxView.tsx`.
- **Rota órfã:** `src/app/producao/` existe mas não está no menu.
- **Sem PROD/schema:** nada aqui toca banco — deploy é só código (Vercel CLI [[vercel-hobby-push-block]]).

---

## Visão geral das fases

- **Fase 1** — Navegação como dado testável (`buildNav` puro) + novo sidebar (grupos, renomes, promoções, `/producao`).
- **Fase 2** — Config de módulo mora no módulo (abas "Configurar" em Agenda/Atendimento/Caixa) + `Configurações` enxuta.
- **Fase 3** — Nav adaptável ao ramo (`moduleVisibleFor` puro + grupo "Mais" colapsável, não-destrutivo).

Cada fase é entregável e reversível; a Fase 1 sozinha já organiza o menu.

---

# FASE 1 — Navegação como dado testável + novo sidebar

## Task 1.1: Extrair `buildNav` puro (TDD)

**Files:**
- Create: `src/lib/nav.ts`
- Test: `src/lib/nav.test.ts`

**Step 1: Write the failing test**

```ts
import { buildNav, type NavCtx } from "./nav";

const base: NavCtx = { isAdmin: false, isAccountAdmin: false, category: "beleza" };

describe("buildNav", () => {
  it("agrupa na nova estrutura (Operação/Clientes/Catálogo/Financeiro/Conta)", () => {
    const titles = buildNav(base).map((g) => g.title);
    expect(titles).toEqual(["Operação", "Clientes", "Catálogo & Estoque", "Financeiro", "Conta"]);
  });
  it("Operação tem Painel, Atendimento, Agenda, Caixa", () => {
    const op = buildNav(base).find((g) => g.title === "Operação")!;
    expect(op.items.map((i) => i.href)).toEqual(["/painel", "/inbox", "/agenda", "/caixa"]);
  });
  it("Administração (billing SaaS) só aparece para admin da plataforma", () => {
    const semAdmin = buildNav(base).flatMap((g) => g.items).some((i) => i.href === "/financeiro");
    expect(semAdmin).toBe(false);
    const comAdmin = buildNav({ ...base, isAdmin: true }).flatMap((g) => g.items)
      .find((i) => i.href === "/financeiro");
    expect(comAdmin?.label).toBe("Administração");
  });
  it("Equipe só para admin da conta", () => {
    expect(buildNav(base).flatMap((g) => g.items).some((i) => i.href === "/equipe")).toBe(false);
    expect(buildNav({ ...base, isAccountAdmin: true }).flatMap((g) => g.items)
      .some((i) => i.href === "/equipe")).toBe(true);
  });
});
```

**Step 2: Run test → FAIL**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: FAIL — `buildNav` não existe.

**Step 3: Write minimal implementation**

Em `src/lib/nav.ts` — o tipo `NavItem`/`NavGroup`, `NavCtx`, e `buildNav` que devolve os 5 grupos. Reusa
os ícones lucide (importados aqui). Migre 1:1 o conteúdo atual de `Sidebar.tsx` para a nova estrutura de
grupos, aplicando os renomes (item inbox `label: "Atendimento"`; billing `label: "Administração"`,
`href` continua `/financeiro`). Filtro `show` por `isAdmin`/`isAccountAdmin` vive **dentro** de `buildNav`.
Deixe `category` recebido mas ainda **sem** efeito (a Fase 3 usa).

**Step 4: Run test → PASS.**

**Step 5: Commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "feat(nav): buildNav puro — navegação como dado testável"
```

## Task 1.2: `Sidebar` renderiza a partir de `buildNav` (refactor sem mudança visual)

**Files:**
- Modify: `src/components/app/Sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx` (passar `category` ao Sidebar — pode ser `null` por ora)

**Step 1:** substituir o array hardcoded por `const navGroups = buildNav({ isAdmin, isAccountAdmin, category })`.
Manter todo o mecanismo de badge/polling e o markup. O layout passa `category` (resolvido de
`getBusinessTemplateId` → `getTemplate(id)?.category`); se null, tudo continua visível.

**Step 2: verificação visual** — `npm run dev` (pare depois): o menu abre na **nova** estrutura de 5
grupos, com os renomes. Badges de inbox/agenda continuam funcionando.

**Step 3: Commit**

```bash
git add src/components/app/Sidebar.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(nav): Sidebar renderiza de buildNav (novo agrupamento + renomes)"
```

## Task 1.3: Promover Catálogo, Estoque, Relatórios e Despesas a rotas próprias

**Files:**
- Create: `src/app/(app)/catalogo/page.tsx`, `.../estoque/page.tsx`, `.../relatorios/page.tsx`, `.../despesas/page.tsx`
- Modify: `src/components/vendas/VendasWorkspace.tsx` (Caixa fica só com Comandas; as abas migram viram páginas)

**Contexto:** hoje Catálogo/Estoque/Despesas/Relatórios são **abas** dentro de `/caixa`. Promovê-las a
rotas dá discoverability e alimenta os grupos "Catálogo & Estoque" e "Financeiro". Cada nova página é
fina: reusa o componente que já existe (`CatalogManager`, `StockPanel`, `ExpensesPanel`, `ReportsPanel`)
com o mesmo gate `canEdit`.

**Step 1:** criar as 4 páginas RSC (espelhar `caixa/page.tsx`: `getTenantContext`, gate, render do
componente existente). `/caixa` mantém só a aba Comandas (vira o PDV puro).

**Step 2: verificação visual** — cada rota abre o painel correto; permissões preservadas.

**Step 3: Commit**

```bash
git add "src/app/(app)/catalogo" "src/app/(app)/estoque" "src/app/(app)/relatorios" "src/app/(app)/despesas" src/components/vendas/VendasWorkspace.tsx
git commit -m "feat(nav): promove catálogo/estoque/relatórios/despesas a rotas próprias"
```

## Task 1.4: Dar um lar à rota `/producao`

**Files:**
- Modify: `src/lib/nav.ts` (item "Produção" no grupo Operação)
- Modify: `src/lib/nav.test.ts`

**Step 1:** adicionar teste: com `category: "alimentacao"`, a Operação inclui `/producao`; com outra
categoria, não (isso já antecipa a Fase 3, mas o item de Produção é o caso mais óbvio de gating).

**Step 2:** incluir o item em `buildNav` gated por `category === "alimentacao"`.

**Step 3: Run test → PASS + commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "feat(nav): item Produção (cozinha) no menu, para ramos de alimentação"
```

---

# FASE 2 — Config de módulo mora no módulo

> Padrão: cada módulo ganha uma aba/seção **"Configurar"** (gated por `canSettings`) que renderiza os
> componentes de settings que hoje vivem em `configuracoes/page.tsx`. Os componentes **não mudam** — só
> mudam de lugar de renderização. No fim, `Configurações` fica só com o global.

## Task 2.1: Aba "Configurar" na Agenda (Profissionais, Horários, Comissão, Link público)

**Files:**
- Modify: `src/components/AgendaView.tsx` (adicionar aba "Configurar")
- Modify: `src/app/(app)/agenda/page.tsx` (carregar os dados que os settings precisam: booking readiness,
  lista de profissionais, etc. — reusar os `get*` já usados em `configuracoes/page.tsx`)

**Step 1:** adicionar uma aba "Configurar" (só quando `canSettings`) que renderiza `ProfessionalsSettings`,
`BookingSettings`, `CommissionSettings`. Passar as props/loaders que hoje o `configuracoes/page.tsx` já
monta (copiar as chamadas de serviço).

**Step 2: verificação visual** — Agenda › Configurar mostra profissionais/horários/comissão/link e tudo
salva igual antes.

**Step 3: Commit**

```bash
git add src/components/AgendaView.tsx "src/app/(app)/agenda/page.tsx"
git commit -m "feat(nav): config da Agenda (profissionais/horários/comissão/link) na própria Agenda"
```

## Task 2.2: Aba "Configurar" no Atendimento (Respostas rápidas, SLA, Biblioteca de mídia)

**Files:**
- Modify: `src/components/inbox/InboxView.tsx` (ou uma sub-rota `/inbox/config`)
- Modify: `src/app/(app)/inbox/page.tsx`

**Step 1:** aba/sub-rota "Configurar" (gated `canSettings`) renderizando `QuickRepliesSettings`,
`InboxSlaSettings`, `MediaLibrarySettings` com os loaders correspondentes.

**Step 2: verificação visual + Commit**

```bash
git add src/components/inbox/InboxView.tsx "src/app/(app)/inbox/page.tsx"
git commit -m "feat(nav): config do Atendimento (respostas rápidas/SLA/mídia) no próprio inbox"
```

## Task 2.3: Aba "Configurar" no Caixa (Impressão, Fiscal)

**Files:**
- Modify: `src/components/vendas/VendasWorkspace.tsx` (aba "Configurar", gated `canEdit`)

**Step 1:** aba "Configurar" renderizando `PosPrintSettings` + o bloco de credencial fiscal
(`getFiscalCredentialStatus` + componente fiscal). Loaders copiados de `configuracoes/page.tsx`.

**Step 2: verificação visual + Commit**

```bash
git add src/components/vendas/VendasWorkspace.tsx
git commit -m "feat(nav): config do Caixa (impressão/fiscal) no próprio Caixa"
```

## Task 2.4: Automação de ciclo de vida → Clientes/Campanhas

**Files:**
- Modify: `src/app/(app)/campaigns/page.tsx` (ou `/clientes`) — render de `LifecycleSettings`

**Step 1:** mover `LifecycleSettings` para uma aba "Automações" em Campanhas (é outbound automático,
mora bem perto de campanhas). Loader `getLifecycleAutomationEnabled`.

**Step 2: Commit**

```bash
git add "src/app/(app)/campaigns/page.tsx"
git commit -m "feat(nav): automação de ciclo de vida na área de Campanhas"
```

## Task 2.5: Enxugar `Configurações` para o global

**Files:**
- Modify: `src/app/(app)/configuracoes/page.tsx`

**Step 1:** remover os imports/render dos componentes já relocados (Professionals, Booking, Commission,
QuickReplies, Sla, MediaLibrary, PosPrint, Fiscal, Lifecycle). Deixar só: `AccountSettings` (conta + IA/
BYOK), `BrandingSettings`, `BusinessCategorySettings` (ramo), `CustomFieldsManager`, `PipelineLabelsManager`.

**Step 2: verificação visual** — Configurações agora é curta e só global; nada quebrou (os removidos
vivem nos módulos). `npx tsc --noEmit` limpo (sem imports órfãos).

**Step 3: Commit**

```bash
git add "src/app/(app)/configuracoes/page.tsx"
git commit -m "refactor(nav): Configurações enxuta — só config global da conta"
```

---

# FASE 3 — Nav adaptável ao ramo (não-destrutiva)

## Task 3.1: `moduleVisibleFor` puro (TDD)

**Files:**
- Modify: `src/lib/nav.ts`
- Modify: `src/lib/nav.test.ts`

**Step 1: Write the failing test**

```ts
import { moduleVisibleFor } from "./nav";

describe("moduleVisibleFor", () => {
  it("Produção só em alimentação", () => {
    expect(moduleVisibleFor("alimentacao", "producao")).toBe(true);
    expect(moduleVisibleFor("beleza", "producao")).toBe(false);
  });
  it("Agenda faz sentido em beleza/saúde, não em varejo/alimentação", () => {
    expect(moduleVisibleFor("beleza", "agenda")).toBe(true);
    expect(moduleVisibleFor("varejo", "agenda")).toBe(false);
  });
  it("Estoque some em serviços sem produto (ex.: servicos-pro)", () => {
    expect(moduleVisibleFor("varejo", "estoque")).toBe(true);
    expect(moduleVisibleFor("servicos-pro", "estoque")).toBe(false);
  });
  it("categoria desconhecida/null → mostra tudo (fail-open)", () => {
    expect(moduleVisibleFor(null, "producao")).toBe(true);
  });
});
```

**Step 2: Run test → FAIL.**

**Step 3: Write minimal implementation** — um mapa `MODULE_RULES: Record<moduleKey, BusinessCategory[]>`
com as categorias onde cada módulo "primário" aparece; `moduleVisibleFor(category, key)` = sem regra ⇒
true; `category == null` ⇒ true (fail-open); senão ⇒ `rules.includes(category)`.

**Step 4: Run test → PASS + commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "feat(nav): moduleVisibleFor — regra pura de visibilidade por ramo (fail-open)"
```

## Task 3.2: `buildNav` aplica o ramo, movendo o escondido para "Mais" (não some)

**Files:**
- Modify: `src/lib/nav.ts`
- Modify: `src/lib/nav.test.ts`

**Step 1: Write the failing test** — com `category: "servicos-pro"`, Estoque **não** está nos grupos
principais mas aparece num grupo `title: "Mais"` (nada é removido de fato):

```ts
it("módulo fora do ramo vai para 'Mais', não some", () => {
  const groups = buildNav({ isAdmin:false, isAccountAdmin:false, category:"servicos-pro" });
  const principais = groups.filter((g) => g.title !== "Mais").flatMap((g) => g.items);
  expect(principais.some((i) => i.href === "/estoque")).toBe(false);
  const mais = groups.find((g) => g.title === "Mais");
  expect(mais?.items.some((i) => i.href === "/estoque")).toBe(true);
});
```

**Step 2: Run test → FAIL.**

**Step 3: Write minimal implementation** — em `buildNav`, particionar os itens "gated" por
`moduleVisibleFor(category, key)`: visíveis ficam no grupo; os demais são coletados num grupo final
`"Mais"` (colapsável na UI). Itens sem regra e itens de papel (admin/conta) nunca vão para "Mais".

**Step 4: Run test → PASS + commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "feat(nav): itens fora do ramo caem em 'Mais' colapsável (nada fica inacessível)"
```

## Task 3.3: Grupo "Mais" colapsável na UI

**Files:**
- Modify: `src/components/app/Sidebar.tsx`

**Step 1:** renderizar o grupo `"Mais"` como uma seção **colapsada por padrão** (um `<details>`/toggle),
para não pesar o menu mas manter tudo a um clique. Respeita os tokens do tema.

**Step 2: verificação visual** — logar como conta `servicos-pro`: menu enxuto; abrir "Mais" revela
Estoque/Produção. Conta sem ramo definido → tudo visível (fail-open).

**Step 3: Commit**

```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat(nav): grupo 'Mais' colapsável para módulos fora do ramo"
```

---

## Verificação de ponta a ponta

1. Menu abre nos 5 grupos novos, com renomes (Operação, item "Atendimento"; "Administração" só p/ admin).
2. Catálogo/Estoque/Relatórios/Despesas acessíveis por rota própria; Caixa é o PDV.
3. Cada config de módulo aparece dentro do módulo; Configurações só mostra o global.
4. Conta de barbearia: sem Produção; conta de restaurante: com Produção; conta `servicos-pro`: Estoque
   dentro de "Mais". Conta sem ramo: tudo visível.
5. `npx vitest run src/lib/nav.test.ts` verde + `npx tsc --noEmit` limpo.
6. Deploy só de código (sem SQL): `vercel deploy --prod` e smoke em `/painel`, `/agenda`, `/caixa`.

---

## Riscos e notas

- **Fail-open é regra de ouro:** categoria null/desconhecida ⇒ mostra tudo; gating só **move para "Mais"**,
  nunca remove — impossível prender o usuário sem um módulo.
- **Zero schema** — deploy é só front-end/roteamento; sem `onda-*.sql`, sem toque no Supabase.
- **Componentes de settings não mudam** — só o local de render. Cuidado ao copiar os *loaders* de
  `configuracoes/page.tsx` para os `page.tsx` dos módulos (mesmas chamadas de serviço, mesmo gate).
- **Badges** (inbox/agenda) seguem no `Sidebar` — `buildNav` só descreve a estrutura; o polling continua
  no componente.
- **Rotas antigas:** manter `/caixa?tab=...` funcionando ou redirecionar as abas migradas para as novas
  rotas, para não quebrar links/favoritos.
- **Não é schema, mas é iniciativa 14** — adicionar a linha no roadmap-mestre e marcar o status ao fim
  ([[prod-schema-drift-destravar]] não se aplica; é só código).
