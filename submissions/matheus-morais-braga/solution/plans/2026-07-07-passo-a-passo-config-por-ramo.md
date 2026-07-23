# Passo a passo de configuração por ramo (checklist adaptativo) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (evolução das iniciativas 11 "verticais unificadas" e 14 "reorganização da navegação" — **sem onda de schema**).

**Goal:** transformar o "Primeiros passos" (`OnboardingChecklist`) num passo a passo de configuração **que se adapta ao ramo**: quem tem estoque vê os passos de produto/estoque; quem trabalha com hora marcada vê os passos de catálogo de serviços + agenda; cada passo é acionável (leva à tela certa) e marca ✓ automático quando concluído.

**Architecture:** a decisão de *quais* passos aparecem vira uma **função pura** `planOnboardingSteps(ctx)` — mesmo padrão do `buildNav` em `nav.ts`. Ela recebe categoria do ramo + gates do plano e devolve a lista ordenada de passos (com uma `variant` p/ o copy do catálogo). A relevância "estoque × agenda" **não é reescrita** — reusa `moduleVisibleFor(category, "estoque"|"agenda")` de [nav.ts](../../src/lib/nav.ts), a mesma fonte de verdade da sidebar. O `getOnboardingState` só faz as contagens no banco e casa cada passo com seu `done`. O componente ganha o copy/CTA dos passos novos.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma · Vitest · lucide-react. **Sem Prisma migration / schema novo** — todos os models e campos já existem (`CatalogItem.trackStock`, `Professional`). Deploy é só código.

**Escopo (o que NÃO entra):** página pública de apresentação "como funciona no seu ramo" (fase futura — leria da mesma fonte); tour guiado tela-a-tela; persistir "passo pulado" no banco; qualquer alteração nos componentes de destino (catálogo/estoque/agenda) — o checklist só **linka** para eles.

**Decisões de produto:**
- **Adaptativo, não mutuamente exclusivo.** Ramos como beleza/automotivo têm estoque **e** agenda — recebem os dois blocos. A branch é aditiva por capacidade, não um "ou".
- **Fail-open.** Categoria `null`/desconhecida ⇒ mostra o superconjunto seguro (nunca esconde um passo que o dono precisaria).
- **Copy que fala a língua do ramo.** O passo de catálogo diz "produtos", "serviços" ou "produtos e serviços" conforme o ramo.
- **✓ automático.** Cada passo detecta "feito" contando registros reais (produtos, profissionais, etc.), como o checklist já faz com `numbers > 0`.

---

## Contexto do código existente (leia antes de começar)

- **Service (fonte da verdade dos passos):** [onboarding.service.ts](../../src/server/services/onboarding.service.ts) — `OnboardingStepKey` (L8-9), `getOnboardingState(userId)` (L31). Já é **ramo-aware**: L53 usa `moduleVisibleFor(category, "agenda")` para gatear o passo `meeting`. Já resolve `category` de `businessTemplateId` (L45-47) e os gates do plano de `PLAN_LIMITS[plan]` (L44, `qualify`/`campaigns`/`schedule`).
- **Componente:** [OnboardingChecklist.tsx](../../src/components/OnboardingChecklist.tsx) — `STEP_META` (L28-80) mapeia cada `key` → ícone/título/descrição/href/cta/help. Render em L88; some quando `state.done`.
- **Regra estoque × agenda (reusar, não recriar):** [nav.ts:58-87](../../src/lib/nav.ts#L58-L87) — `MODULE_RULES` (`estoque: [varejo, alimentacao, automotivo, beleza]`, `agenda: [saude, beleza, automotivo, casa, educacao, servicos-pro, fitness, eventos, imoveis-turismo]`) + `moduleVisibleFor(category, key)` (fail-open).
- **Models de destino (já existem — sem schema):** `CatalogItem` ([schema.prisma:385](../../prisma/schema.prisma#L385), campos `accountId`, `kind`, `trackStock`), `Professional` ([schema.prisma:971](../../prisma/schema.prisma#L971), `accountId`). Scoping por `accountId` = `tenantUserId` = o `userId` que o service recebe.
- **Onde o checklist aparece:** [leads/page.tsx:16](../../src/app/(app)/leads/page.tsx#L16) monta `<OnboardingChecklist state={...} />`.
- **Rotas de destino dos CTAs (já existem, iniciativa 14):** `/catalogo`, `/estoque`, `/agenda`, `/configuracoes#configuracao-rapida-ramo`, `/empresas`, `/leads`, `/campaigns`.
- **Sem PROD/schema:** nada toca banco — deploy é só código (Vercel CLI, [[vercel-hobby-push-block]]).

---

## Visão geral das fases

- **Fase 1** — `planOnboardingSteps(ctx)` puro (TDD): decide quais passos e em que ordem, por ramo+plano. Zero banco.
- **Fase 2** — `getOnboardingState` usa o seletor puro + conta os passos novos (catálogo/estoque/agenda).
- **Fase 3** — `STEP_META` ganha os passos novos (ícone/copy/CTA), com o copy do catálogo adaptando ao ramo.
- **Fase 4** — Verificação E2E por ramo + deploy.

Cada fase é entregável; a Fase 1 sozinha já é testável e não muda a UI.

---

# FASE 1 — Seletor de passos puro (`planOnboardingSteps`)

## Task 1.1: Definir o seletor puro com TDD

**Files:**
- Modify: `src/server/services/onboarding.service.ts`
- Test: `src/server/services/onboarding.service.test.ts` (create)

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planOnboardingSteps, type OnboardingPlanCtx } from "./onboarding.service";

// Plano completo (todas as features contratadas) para isolar o efeito do ramo.
const full: Omit<OnboardingPlanCtx, "category"> = {
  qualify: true,
  campaigns: true,
  schedule: true,
};
const keys = (ctx: OnboardingPlanCtx) => planOnboardingSteps(ctx).map((s) => s.key);

describe("planOnboardingSteps", () => {
  it("ramo de serviço/agenda (saude): catálogo de serviços + agenda, sem estoque", () => {
    const ks = keys({ ...full, category: "saude" });
    expect(ks).toContain("catalogo");
    expect(ks).toContain("agenda_setup");
    expect(ks).toContain("meeting");
    expect(ks).not.toContain("estoque");
    // copy do catálogo fala "serviços"
    const cat = planOnboardingSteps({ ...full, category: "saude" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("servicos");
  });

  it("ramo de varejo: catálogo de produtos + estoque, sem agenda", () => {
    const ks = keys({ ...full, category: "varejo" });
    expect(ks).toContain("estoque");
    expect(ks).not.toContain("agenda_setup");
    expect(ks).not.toContain("meeting");
    const cat = planOnboardingSteps({ ...full, category: "varejo" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("produtos");
  });

  it("ramo híbrido (beleza): estoque E agenda; catálogo fala 'produtos e serviços'", () => {
    const ks = keys({ ...full, category: "beleza" });
    expect(ks).toContain("estoque");
    expect(ks).toContain("agenda_setup");
    const cat = planOnboardingSteps({ ...full, category: "beleza" }).find((s) => s.key === "catalogo");
    expect(cat?.variant).toBe("ambos");
  });

  it("plano sem agenda: nenhum passo de agenda mesmo em ramo de hora marcada", () => {
    const ks = keys({ ...full, schedule: false, category: "saude" });
    expect(ks).not.toContain("agenda_setup");
    expect(ks).not.toContain("meeting");
  });

  it("plano sem qualify: sem passo de IA; sem campaigns: sem passo de campanha", () => {
    expect(keys({ ...full, qualify: false, category: "varejo" })).not.toContain("ai");
    expect(keys({ ...full, campaigns: false, category: "varejo" })).not.toContain("campaign");
  });

  it("categoria null (fail-open): mostra estoque E agenda (superconjunto seguro)", () => {
    const ks = keys({ ...full, category: null });
    expect(ks).toContain("estoque");
    expect(ks).toContain("agenda_setup");
    expect(ks).toContain("catalogo");
  });

  it("ordem segue a rotina do dono: ramo → número → IA → catálogo → estoque → agenda → leads → campanha → 1ª venda", () => {
    const ks = keys({ ...full, category: "beleza" });
    expect(ks).toEqual([
      "ramo", "number", "ai", "catalogo", "estoque", "agenda_setup", "leads", "campaign", "meeting",
    ]);
  });
});
```

**Step 2: Run test → FAIL**

Run: `npx vitest run src/server/services/onboarding.service.test.ts`
Expected: FAIL — `planOnboardingSteps` não é exportado.

**Step 3: Write minimal implementation**

Em `onboarding.service.ts`, **acima** de `getOnboardingState`, adicionar o tipo de key novo, o contexto puro e o seletor. Estender `OnboardingStepKey`:

```ts
import { moduleVisibleFor } from "@/lib/nav";
import type { BusinessCategory } from "@/lib/business-templates";

export type OnboardingStepKey =
  | "ramo" | "number" | "ai" | "catalogo" | "estoque" | "agenda_setup"
  | "leads" | "campaign" | "meeting";

/** Variante de copy do passo de catálogo, derivada das capacidades do ramo. */
export type CatalogVariant = "produtos" | "servicos" | "ambos";

export interface PlannedStep {
  key: OnboardingStepKey;
  variant?: CatalogVariant; // só o passo "catalogo" usa
}

/** Entrada pura do seletor: ramo + gates do plano (sem tocar no banco). */
export interface OnboardingPlanCtx {
  category: BusinessCategory | null;
  qualify: boolean;   // PLAN_LIMITS.qualify — libera IA/qualificação
  campaigns: boolean; // PLAN_LIMITS.campaigns
  schedule: boolean;  // PLAN_LIMITS.schedule — libera agenda
}

/**
 * Decide QUAIS passos aparecem e em que ordem, por ramo + plano. Puro e
 * testável (espelha `buildNav`). A relevância estoque×agenda reusa
 * `moduleVisibleFor` — mesma regra da sidebar, zero duplicação. Fail-open:
 * category null ⇒ estoque e agenda ambos visíveis (superconjunto seguro).
 */
export function planOnboardingSteps(ctx: OnboardingPlanCtx): PlannedStep[] {
  const { category, qualify, campaigns, schedule } = ctx;
  const hasEstoque = moduleVisibleFor(category, "estoque");
  const hasAgenda = schedule && moduleVisibleFor(category, "agenda");

  const catalogVariant: CatalogVariant =
    hasEstoque && hasAgenda ? "ambos" : hasEstoque ? "produtos" : "servicos";

  const steps: (PlannedStep & { show: boolean })[] = [
    { key: "ramo",         show: true },
    { key: "number",       show: true },
    { key: "ai",           show: qualify },
    { key: "catalogo",     show: true, variant: catalogVariant },
    { key: "estoque",      show: hasEstoque },
    { key: "agenda_setup", show: hasAgenda },
    { key: "leads",        show: true },
    { key: "campaign",     show: campaigns },
    { key: "meeting",      show: hasAgenda },
  ];

  return steps.filter((s) => s.show).map(({ show: _show, ...s }) => s);
}
```

**Step 4: Run test → PASS**

Run: `npx vitest run src/server/services/onboarding.service.test.ts`
Expected: PASS (7 casos verdes).

**Step 5: Commit**

```bash
git add src/server/services/onboarding.service.ts src/server/services/onboarding.service.test.ts
git commit -m "feat(onboarding): planOnboardingSteps puro — passos por ramo (estoque x agenda)"
```

---

# FASE 2 — `getOnboardingState` usa o seletor + conta os passos novos

## Task 2.1: Ligar o seletor puro e detectar "feito" de catálogo/estoque/agenda

**Files:**
- Modify: `src/server/services/onboarding.service.ts:31-67` (`getOnboardingState`)

**Contexto:** hoje `getOnboardingState` monta o array `all` inline (L55-62) e filtra por `show`. Vamos trocar essa montagem por `planOnboardingSteps(...)` e casar cada passo planejado com seu `done`, adicionando 3 contagens (catálogo, estoque, profissionais). Scoping: `CatalogItem.accountId` e `Professional.accountId` = `userId` (o dono/tenant).

**Step 1:** ampliar o `Promise.all` com as 3 contagens novas:

```ts
const [user, numbers, leads, campaigns, meetings, catalogItems, stockItems, professionals] =
  await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, aiProvider: true, businessTemplateId: true },
    }),
    prisma.whatsAppNumber.count({ where: { userId } }),
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.meeting.count({ where: { lead: { userId } } }),
    prisma.catalogItem.count({ where: { accountId: userId } }),
    prisma.catalogItem.count({ where: { accountId: userId, trackStock: true } }),
    prisma.professional.count({ where: { accountId: userId } }),
  ]);
```

**Step 2:** substituir a montagem de `all`/`steps` (L49-64) por: computar os gates, chamar o seletor puro, e mapear `done` por key.

```ts
const plan = user?.plan ?? null;
const limits = plan ? PLAN_LIMITS[plan] : null;
const category = user?.businessTemplateId
  ? getTemplate(user.businessTemplateId)?.category ?? null
  : null;

const planned = planOnboardingSteps({
  category,
  qualify: limits?.qualify ?? false,
  campaigns: limits?.campaigns ?? true,
  schedule: limits?.schedule ?? false,
});

const DONE: Record<OnboardingStepKey, boolean> = {
  ramo:         !!user?.businessTemplateId,
  number:       numbers > 0,
  ai:           !!user?.aiProvider,
  catalogo:     catalogItems > 0,
  estoque:      stockItems > 0,
  agenda_setup: professionals > 0,
  leads:        leads > 0,
  campaign:     campaigns > 0,
  meeting:      meetings > 0,
};

const steps: OnboardingStep[] = planned.map((s) => ({
  key: s.key,
  done: DONE[s.key],
  variant: s.variant, // carrega a variante do catálogo até a UI
}));
const completed = steps.filter((s) => s.done).length;
return { steps, completed, total: steps.length, done: completed === steps.length };
```

Atualizar a interface `OnboardingStep` (L11-14) para carregar a variante:

```ts
export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  variant?: CatalogVariant; // só "catalogo" traz
}
```

> **Nota DRY:** `moduleVisibleFor` e `getTemplate` já estão importados no arquivo (L3-4). Remover o cálculo antigo de `showAi`/`showCampaign`/`showMeeting` (L50-53) — agora vivem dentro de `planOnboardingSteps`.

**Step 3:** rodar os testes existentes + typecheck para garantir que nada regrediu.

Run: `npx vitest run src/server/services/onboarding.service.test.ts && npx tsc --noEmit`
Expected: PASS + zero erros de tipo.

**Step 4: Commit**

```bash
git add src/server/services/onboarding.service.ts
git commit -m "feat(onboarding): estado conta catálogo/estoque/profissionais por ramo"
```

---

# FASE 3 — UI: passos novos no checklist

## Task 3.1: `STEP_META` ganha catálogo/estoque/agenda + copy adaptativo

**Files:**
- Modify: `src/components/OnboardingChecklist.tsx`

**Step 1:** importar os ícones novos e `CatalogVariant`, e adicionar as 3 entradas em `STEP_META`. O passo `catalogo` tem título/descrição **dependentes da variante** — por isso `STEP_META.catalogo` guarda um resolvedor. Manter as entradas existentes (`ramo`, `number`, `ai`, `leads`, `campaign`, `meeting`) intactas.

```ts
import { Store, MessageSquare, Upload, Megaphone, Bot, CalendarClock,
  Package, Boxes, Users2, ArrowRight, Check } from "lucide-react";
import type { CatalogVariant } from "@/server/services/onboarding.service";

// Copy do catálogo por variante de ramo.
const CATALOG_COPY: Record<CatalogVariant, { title: string; description: string }> = {
  produtos: {
    title: "Cadastre seus produtos",
    description: "Adicione itens com preço (e custo, p/ ver sua margem no caixa).",
  },
  servicos: {
    title: "Cadastre seus serviços",
    description: "Adicione os serviços com preço e duração — a agenda usa a duração.",
  },
  ambos: {
    title: "Cadastre produtos e serviços",
    description: "Monte seu catálogo: serviços (com duração) e produtos (com preço/custo).",
  },
};
```

Adicionar a `STEP_META`:

```ts
  catalogo: {
    icon: Package,
    // título/descrição resolvidos por variante em tempo de render (ver Step 2)
    title: "Monte seu catálogo",
    description: "Cadastre o que você vende.",
    href: "/catalogo",
    cta: "Abrir catálogo",
    help: "O catálogo alimenta o caixa, a agenda e a IA de atendimento. Serviços têm duração; produtos podem ter controle de estoque.",
  },
  estoque: {
    icon: Boxes,
    title: "Ligue o controle de estoque",
    description: "Ative o estoque nos produtos e informe as quantidades iniciais.",
    href: "/estoque",
    cta: "Configurar estoque",
    help: "O estoque baixa sozinho no fechamento da comanda e avisa quando um produto está acabando. Opt-in por produto — só liga no que você quer controlar.",
  },
  agenda_setup: {
    icon: Users2,
    title: "Configure sua agenda",
    description: "Cadastre profissionais/recursos e seus horários de atendimento.",
    href: "/agenda",
    cta: "Configurar agenda",
    help: "Com profissionais e expediente definidos, a Agenda evita conflitos de horário e o link público de agendamento passa a funcionar.",
  },
```

**Step 2:** no render (L106-135), resolver título/descrição do passo `catalogo` pela `variant`:

```tsx
{state.steps.map((step) => {
  const meta = STEP_META[step.key];
  const Icon = meta.icon;
  const copy =
    step.key === "catalogo" && step.variant
      ? CATALOG_COPY[step.variant]
      : { title: meta.title, description: meta.description };
  // ...usar copy.title / copy.description no lugar de meta.title / meta.description
```

Substituir os usos de `meta.title`/`meta.description` dentro do `<li>` por `copy.title`/`copy.description` (o `meta.help`/`meta.href`/`meta.cta`/`meta.icon` seguem vindo de `meta`).

**Step 3: verificação visual** — parar o `next dev` se estiver rodando ([[prisma-generate-dev-server-lock]]), então `npm run dev`:
- Conta **varejo**: aparecem "Cadastre seus produtos" + "Ligue o controle de estoque"; **não** aparece agenda.
- Conta **saúde**: "Cadastre seus serviços" + "Configure sua agenda" + "Agende sua primeira reunião"; **não** aparece estoque.
- Conta **beleza**: "Cadastre produtos e serviços" + estoque + agenda.
- Cada CTA abre a rota certa; passos concluídos mostram ✓ verde e riscado.

**Step 4: Commit**

```bash
git add src/components/OnboardingChecklist.tsx
git commit -m "feat(onboarding): passos de catálogo/estoque/agenda no checklist, copy por ramo"
```

## Task 3.2: Guardar o contador crescente ("X de N") sem sustos

**Files:**
- Modify: `src/components/OnboardingChecklist.tsx` (só conferência)

**Contexto:** com mais passos, `state.total` cresce e o card demora mais para sumir (`state.done`). Isso é desejado (é mais configuração real), mas vale um teste de sanidade de que o header "X de N" e o `state.done` seguem coerentes — nenhuma mudança de código esperada, só conferir que o componente lê `state.completed`/`state.total` (já lê, L100-102).

**Step 1:** conferência visual: numa conta nova de beleza o header mostra "0 de 9" e vai subindo a cada passo concluído; ao concluir todos, o card some.

**Step 2:** (sem commit se não houve mudança de código.)

---

# FASE 4 — Verificação de ponta a ponta + deploy

## Task 4.1: Suite + typecheck

**Step 1:** rodar a suíte inteira e o typecheck.

Run: `npx vitest run && npx tsc --noEmit`
Expected: verde (incluindo `onboarding.service.test.ts`), zero erros de tipo.

## Task 4.2: Smoke por ramo (dev)

**Step 1:** para 3 contas de ramos distintos (varejo, saúde, beleza) abrir `/leads` e conferir a matriz:

| Ramo | catálogo diz | estoque? | agenda? | 1ª venda? |
|---|---|---|---|---|
| varejo | produtos | ✅ | ❌ | ❌ |
| saúde | serviços | ❌ | ✅ | ✅ |
| beleza | produtos e serviços | ✅ | ✅ | ✅ |
| (sem ramo) | serviços* | ✅ | ✅ | ✅ |

\* fail-open: sem ramo, catálogo cai em "serviços" mas estoque+agenda aparecem (superconjunto seguro). Aceitável; refinar o copy do fail-open é melhoria futura, não bloqueia.

**Step 2:** concluir um passo real (ex.: cadastrar um produto) e recarregar → o passo vira ✓ e o contador sobe.

## Task 4.3: Deploy (só código, sem schema)

**Step 1:** confirmar que **não há** `onda-*.sql` novo (esta iniciativa não toca banco).

**Step 2:** deploy via Vercel CLI ([[vercel-hobby-push-block]]):

```bash
env -u CLAUDECODE CI=1 npx vercel deploy --prod
```

**Step 3:** smoke em PROD: abrir `/leads` numa conta real e confirmar que o checklist reflete o ramo. Worker **não** precisa de deploy (mudança é só web).

---

## Verificação de ponta a ponta

1. `planOnboardingSteps` puro cobre serviço/varejo/híbrido/fail-open + gates de plano (7 casos verdes).
2. Ramo de varejo mostra produtos+estoque, sem agenda; ramo de saúde mostra serviços+agenda, sem estoque; beleza mostra os dois; sem ramo mostra o superconjunto.
3. Cada passo novo tem CTA que abre a rota certa e vira ✓ ao concluir de verdade.
4. `npx vitest run` + `npx tsc --noEmit` limpos.
5. Deploy só de código; smoke em `/leads` em PROD reflete o ramo.

---

## Riscos e notas

- **Reuso é regra:** a decisão estoque×agenda vem de `moduleVisibleFor`/`MODULE_RULES` ([nav.ts](../../src/lib/nav.ts)). Se um dia mudar o mapa de ramos, o checklist acompanha sozinho — **não** duplicar a regra aqui.
- **Fail-open:** categoria `null` ⇒ superconjunto (estoque + agenda visíveis). Nunca esconder um passo que o dono precisaria; no máximo mostrar um a mais.
- **Scoping multitenant:** `CatalogItem`/`Professional` são escopados por `accountId` = `tenantUserId` = o `userId` que o service recebe. Não trocar por `userId` de coluna inexistente nesses models.
- **Sem schema / sem worker:** deploy é só web (Vercel). Sem `onda-*.sql`, sem toque no Supabase, sem restart do worker Oracle.
- **Contador maior:** com 9 passos possíveis o card demora mais para sumir — é intencional (mais configuração guiada). Se ficar pesado, uma melhoria futura é colapsar passos concluídos.
- **Página pública de apresentação** (por ramo, sem login) fica fora — quando vier, lê de `business-templates` + `nav.ts` (mesma fonte), então é reaproveitamento, não retrabalho.
- **É evolução das iniciativas 11 e 14** — ao concluir, anotar a linha no roadmap-mestre e no índice de memória.
```