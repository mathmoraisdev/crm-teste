# Onboarding guiado por ramo + gates contextuais — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformar o onboarding em um roteiro guiado que começa pela escolha do ramo, adapta os passos ao tipo de negócio e ao plano, explica cada passo com uma nota "?" e — em vez de trancar o app inteiro — bloqueia apenas as ações que literalmente não funcionam sem um pré-requisito (empty-state contextual).

**Architecture:** Três frentes independentes, sem schema novo. (1) `getOnboardingState` ganha um passo `ramo` (primeiro, sempre) e passa a filtrar passos por `category` via `moduleVisibleFor` (mesmo padrão já usado para `plan`). (2) O `OnboardingChecklist` ganha a apresentação do passo `ramo` e uma nota de ajuda "?" (`HelpHint`) por passo. (3) Um componente presentacional reutilizável `SetupRequired` substitui a tela quando falta um pré-requisito duro — aplicado primeiro ao `/inbox` (precisa de número conectado) e à `/agenda` (precisa de profissional+serviço, usando o `getBookingReadiness` que já existe). Tudo *fail-open* e coerente com o princípio do menu ([nav.ts:80](../../src/lib/nav.ts#L80)).

**Tech Stack:** Next.js 15 (App Router, Server Components), React 19, TypeScript, Vitest, Tailwind (design tokens — nunca hex fixo, ver [[design-tokens-dark-theme]]), lucide-react.

---

## Contexto essencial (leia antes de começar)

- **Fonte da verdade do ramo:** `User.businessTemplateId` (id de `BUSINESS_TEMPLATES`). Lido por `getBusinessTemplateId(userId)` em [account.service.ts:379](../../src/server/services/account.service.ts#L379). O id → categoria via `getTemplate(id)?.category` ([business-templates.ts:10](../../src/lib/business-templates.ts#L10)).
- **Relevância por ramo:** `moduleVisibleFor(category, moduleKey)` em [nav.ts:82](../../src/lib/nav.ts#L82) — *fail-open* (sem regra ou `category` null ⇒ `true`). Chaves relevantes: `"agenda"`, `"estoque"`, `"producao"`.
- **Estado do checklist:** `getOnboardingState(userId)` em [onboarding.service.ts:29](../../src/server/services/onboarding.service.ts#L29) — já filtra por `plan` via `PLAN_LIMITS`. Testes em [onboarding.service.test.ts](../../src/server/services/onboarding.service.test.ts).
- **Onde o checklist é renderizado hoje:** topo da página de leads, [leads/page.tsx:11-17](<../../src/app/(app)/leads/page.tsx#L11>). Consome `getOnboardingState(getTenantUserId())`.
- **Apresentação dos passos:** `STEP_META` em [OnboardingChecklist.tsx:26](../../src/components/OnboardingChecklist.tsx#L26).
- **Wizard de ramo (a peça poderosa, hoje escondida):** [VerticalOnboardingWizard.tsx](../../src/components/VerticalOnboardingWizard.tsx), renderizado só em [configuracoes/page.tsx:85](<../../src/app/(app)/configuracoes/page.tsx#L85>).
- **Rotas candidatas a gate:** `/inbox` ([inbox/page.tsx](<../../src/app/(app)/inbox/page.tsx>)) precisa de ≥1 número; `/agenda` ([agenda/page.tsx](<../../src/app/(app)/agenda/page.tsx>)) já calcula `getBookingReadiness` (`{ hasProfessionalWithHours, hasBookableService, ready }`, [booking-settings.service.ts:132](../../src/server/services/booking-settings.service.ts#L132)).
- **Perms:** `ctx.perms.canSettings` diz quem pode configurar (dono/admin da conta). Gates devem mostrar CTA de configurar só a quem pode; para operador sem permissão, mostrar mensagem passiva.
- **Não há primitivo de tooltip/popover** em `src/components/ui/` — vamos criar um `HelpHint` mínimo e sem dependências (mobile-friendly, clique/toque, sem hover).
- **Comando de teste:** `npx vitest run <arquivo>` (script `test` = `vitest run`).
- **NUNCA** usar hex fixo nem utilities de cor default; usar tokens (`text-ink`, `text-slate-500`, `bg-inset`, `border-line-default`, `bg-brand-500`, `bg-danger-surface`, etc.), ver [[design-tokens-dark-theme]].

---

## Frente A — Checklist ciente do ramo (service)

### Task A1: `getOnboardingState` — passo `ramo` primeiro + filtro por categoria

**Files:**
- Modify: `src/server/services/onboarding.service.ts`
- Test: `src/server/services/onboarding.service.test.ts`

**Step 1: Escrever os testes que falham**

Adicione ao mock do prisma o `businessTemplateId` no `user.findUnique`. Substitua o corpo do `mockDb` para aceitar `businessTemplateId` e ajuste os testes existentes + adicione novos. Edite [onboarding.service.test.ts](../../src/server/services/onboarding.service.test.ts):

Em `mockDb`, troque o `mockResolvedValue` do user para incluir o ramo:

```typescript
async function mockDb(opts: {
  plan: string | null;
  aiProvider?: string | null;
  businessTemplateId?: string | null;
  numbers?: number;
  leads?: number;
  campaigns?: number;
  meetings?: number;
}) {
  const { prisma } = await import("@/server/db/client");
  (prisma.user.findUnique as any).mockResolvedValue({
    plan: opts.plan,
    aiProvider: opts.aiProvider ?? null,
    businessTemplateId: opts.businessTemplateId ?? null,
  });
  (prisma.whatsAppNumber.count as any).mockResolvedValue(opts.numbers ?? 0);
  (prisma.lead.count as any).mockResolvedValue(opts.leads ?? 0);
  (prisma.campaign.count as any).mockResolvedValue(opts.campaigns ?? 0);
  (prisma.meeting.count as any).mockResolvedValue(opts.meetings ?? 0);
}
```

Atualize as asserções dos testes existentes para incluir `"ramo"` como PRIMEIRO passo e adicione os novos casos. Substitua os `it(...)` existentes por estes:

```typescript
it("INICIAL: ramo + número + leads (sem IA/campanha/agenda) → total = 3", async () => {
  await mockDb({ plan: "INICIAL" });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads"]);
});

it("ESCALA sem ramo definido (category null): agenda aparece (fail-open) → 6 passos", async () => {
  await mockDb({ plan: "ESCALA", businessTemplateId: null });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.steps.map((s) => s.key)).toEqual([
    "ramo",
    "number",
    "leads",
    "ai",
    "campaign",
    "meeting",
  ]);
});

it("ESCALA com ramo SEM agenda (borracharia) omite o passo 'meeting'", async () => {
  await mockDb({ plan: "ESCALA", businessTemplateId: "borracharia" });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.steps.map((s) => s.key)).not.toContain("meeting");
  expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads", "ai", "campaign"]);
});

it("ESCALA com ramo COM agenda (salao-beleza) mantém o passo 'meeting'", async () => {
  await mockDb({ plan: "ESCALA", businessTemplateId: "salao-beleza" });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.steps.map((s) => s.key)).toContain("meeting");
});

it("passo 'ramo' fica done quando businessTemplateId != null", async () => {
  await mockDb({ plan: "INICIAL", businessTemplateId: "salao-beleza" });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  const ramo = state.steps.find((s) => s.key === "ramo");
  expect(ramo?.done).toBe(true);
});

it("plano null → ramo + número + leads + campanha (total = 4)", async () => {
  await mockDb({ plan: null });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.steps.map((s) => s.key)).toEqual(["ramo", "number", "leads", "campaign"]);
});

it("done = true só quando todos os passos aplicáveis (incl. ramo) estão concluídos", async () => {
  await mockDb({
    plan: "ESCALA",
    aiProvider: "openai",
    businessTemplateId: "salao-beleza",
    numbers: 1,
    leads: 3,
    campaigns: 1,
    meetings: 1,
  });
  const { getOnboardingState } = await import("./onboarding.service");
  const state = await getOnboardingState("dono-1");
  expect(state.done).toBe(true);
});
```

**Step 2: Rodar os testes e ver falhar**

Run: `npx vitest run src/server/services/onboarding.service.test.ts`
Expected: FAIL — `"ramo"` não existe em `OnboardingStepKey` e o service não seleciona `businessTemplateId`.

**Step 3: Implementar o mínimo**

Edite [onboarding.service.ts](../../src/server/services/onboarding.service.ts). Adicione o import da categoria e do gate, o novo key, e a lógica de categoria:

No topo, junto aos imports:

```typescript
import { getTemplate } from "@/lib/business-templates";
import { moduleVisibleFor } from "@/lib/nav";
```

Troque o tipo do key:

```typescript
export type OnboardingStepKey =
  | "ramo" | "number" | "leads" | "ai" | "campaign" | "meeting";
```

No `getOnboardingState`, adicione `businessTemplateId` ao `select` do user e derive a categoria:

```typescript
  const [user, numbers, leads, campaigns, meetings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, aiProvider: true, businessTemplateId: true },
    }),
    prisma.whatsAppNumber.count({ where: { userId } }),
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.meeting.count({ where: { lead: { userId } } }),
  ]);

  const plan = user?.plan ?? null;
  const limits = plan ? PLAN_LIMITS[plan] : null;
  const category = user?.businessTemplateId
    ? getTemplate(user.businessTemplateId)?.category ?? null
    : null;

  // Plano null (legado/admin) libera o subconjunto seguro; com plano, respeita o gating.
  const showAi = limits?.qualify ?? false;
  const showCampaign = limits?.campaigns ?? true;
  // Agenda só se o plano permite E o ramo usa hora marcada (fail-open p/ category null).
  const showMeeting = (limits?.schedule ?? false) && moduleVisibleFor(category, "agenda");

  const all: Array<OnboardingStep & { show: boolean }> = [
    { key: "ramo",     done: !!user?.businessTemplateId, show: true },
    { key: "number",   done: numbers > 0,        show: true },
    { key: "leads",    done: leads > 0,          show: true },
    { key: "ai",       done: !!user?.aiProvider, show: showAi },
    { key: "campaign", done: campaigns > 0,      show: showCampaign },
    { key: "meeting",  done: meetings > 0,       show: showMeeting },
  ];
```

O restante da função (`steps`/`completed`/`total`/`done`) permanece igual.

**Step 4: Rodar os testes e ver passar**

Run: `npx vitest run src/server/services/onboarding.service.test.ts`
Expected: PASS (todos).

**Step 5: Commit**

```bash
git add src/server/services/onboarding.service.ts src/server/services/onboarding.service.test.ts
git commit -m "feat(onboarding): passo 'ramo' + filtro de passos por ramo (moduleVisibleFor)"
```

---

## Frente B — Nota de ajuda "?" (HelpHint) + apresentação do passo `ramo`

### Task B1: Componente `HelpHint` (nota "?" acessível, mobile-first)

**Files:**
- Create: `src/components/ui/HelpHint.tsx`
- Test: `src/components/ui/HelpHint.test.tsx`

**Step 1: Escrever o teste que falha**

Usaremos `<details>/<summary>` nativos — funciona sem JS, abre por clique/toque (não depende de hover, bom no mobile). Crie [HelpHint.test.tsx](../../src/components/ui/HelpHint.test.tsx):

```typescript
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpHint } from "./HelpHint";

describe("HelpHint", () => {
  it("renderiza o texto de ajuda e um gatilho acessível", () => {
    const html = renderToStaticMarkup(<HelpHint label="Por que isso importa">A IA usa este texto.</HelpHint>);
    expect(html).toContain("A IA usa este texto.");
    expect(html).toContain("Por que isso importa"); // aria-label no gatilho
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/ui/HelpHint.test.tsx`
Expected: FAIL — módulo `./HelpHint` não existe.

**Step 3: Implementar**

Crie [HelpHint.tsx](../../src/components/ui/HelpHint.tsx). Sem `"use client"` — é puro markup (`<details>` cuida da interação):

```tsx
import { HelpCircle } from "lucide-react";

/**
 * Nota de ajuda "?" contextual. Usa <details>/<summary> nativo: abre por
 * clique/toque (sem depender de hover, então funciona no mobile) e não precisa
 * de JS de cliente. A instrução PRIMÁRIA deve viver fora daqui, sempre visível;
 * o HelpHint guarda só o detalhe secundário ("por que", "como").
 */
export function HelpHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group inline-block align-middle">
      <summary
        aria-label={label}
        className="inline-flex cursor-pointer list-none items-center text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden"
      >
        <HelpCircle size={14} />
      </summary>
      <div className="mt-1.5 rounded-lg border border-line-default bg-inset px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
        {children}
      </div>
    </details>
  );
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/components/ui/HelpHint.test.tsx`
Expected: PASS.

> Se `react-dom/server` não estiver disponível no ambiente de teste, troque o teste por um smoke de import (`expect(typeof HelpHint).toBe("function")`) — a verificação visual real fica no Task D1.

**Step 5: Commit**

```bash
git add src/components/ui/HelpHint.tsx src/components/ui/HelpHint.test.tsx
git commit -m "feat(ui): HelpHint — nota de ajuda '?' acessível e mobile-first"
```

---

### Task B2: `OnboardingChecklist` — passo `ramo` + `help` por passo

**Files:**
- Modify: `src/components/OnboardingChecklist.tsx`
- Modify: `src/components/VerticalOnboardingWizard.tsx` (âncora p/ o CTA do passo `ramo`)

**Step 1: Adicionar âncora no wizard**

Em [VerticalOnboardingWizard.tsx](../../src/components/VerticalOnboardingWizard.tsx), no `<Card>` do return principal (linha ~190, o segundo `return`, não o de `!canEdit`), adicione `id`:

```tsx
    <Card id="configuracao-rapida-ramo">
```

Faça o mesmo no `<Card>` do bloco `!canEdit` (linha ~174) para o anchor funcionar mesmo sem permissão:

```tsx
      <Card id="configuracao-rapida-ramo">
```

> `Card` repassa props? Confirme em [Card.tsx](../../src/components/ui/Card.tsx). Se `Card` NÃO aceitar `id`, envolva num `<div id="configuracao-rapida-ramo">` em vez de passar a prop.

**Step 2: Adicionar o passo `ramo` e as notas `help` ao `STEP_META`**

Em [OnboardingChecklist.tsx](../../src/components/OnboardingChecklist.tsx):

Importe o ícone `Store` e o `HelpHint`:

```tsx
import {
  Check,
  Store,
  MessageSquare,
  Upload,
  Megaphone,
  Bot,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
```

```tsx
import { HelpHint } from "@/components/ui/HelpHint";
```

Estenda o tipo do `STEP_META` com `help` e adicione a entrada `ramo` como PRIMEIRA:

```tsx
const STEP_META: Record<
  OnboardingStepKey,
  { icon: LucideIcon; title: string; description: string; href: string; cta: string; help: string }
> = {
  ramo: {
    icon: Store,
    title: "Escolha o seu ramo de negócio",
    description: "1 clique configura tema, campos, catálogo, funil e a persona da IA de uma vez.",
    href: "/configuracoes#configuracao-rapida-ramo",
    cta: "Escolher ramo",
    help: "O ramo molda o app inteiro: quais campos aparecem na comanda, o que a IA sabe responder e quais módulos ficam em destaque. Dá pra trocar depois — nada fica travado.",
  },
  number: {
    icon: MessageSquare,
    title: "Conecte um número de WhatsApp",
    description: "Pareie um chip para começar a enviar e receber mensagens.",
    href: "/empresas",
    cta: "Conectar número",
    help: "Sem um número conectado, o Atendimento e as Campanhas não têm por onde enviar mensagem. É o pré-requisito de quase tudo.",
  },
  leads: {
    icon: Upload,
    title: "Importe seus leads",
    description: "Suba um CSV de contatos pelo botão “Importar CSV” aqui em cima.",
    href: "/leads",
    cta: "Importar CSV",
    help: "Aceita um CSV com nome e telefone. Contatos repetidos são ignorados — pode subir a lista inteira sem medo de duplicar.",
  },
  ai: {
    icon: Bot,
    title: "Configure a IA de atendimento",
    description: "Conecte sua chave para a IA qualificar leads automaticamente.",
    href: "/configuracoes",
    cta: "Configurar IA",
    help: "A IA usa a persona e a base de conhecimento do seu ramo para responder no seu tom. Você revisa o texto antes de ligar.",
  },
  campaign: {
    icon: Megaphone,
    title: "Crie e dispare uma campanha",
    description: "Monte a mensagem com {{nome}} e comece a falar com o funil.",
    href: "/campaigns",
    cta: "Criar campanha",
    help: "Use {{nome}} para personalizar. O disparo respeita o número conectado e o ritmo de envio para proteger o chip.",
  },
  meeting: {
    icon: CalendarClock,
    title: "Agende sua primeira reunião",
    description: "Marque um agendamento na Agenda — o lead recebe lembrete no WhatsApp.",
    href: "/agenda",
    cta: "Abrir agenda",
    help: "O lembrete sai automático pelo WhatsApp na véspera e perto da hora, reduzindo faltas. Só aparece para ramos que trabalham com hora marcada.",
  },
};
```

**Step 3: Renderizar a nota `?` ao lado do título**

No corpo do `.map`, ao lado do `<p>` do `meta.title`, injete o `HelpHint`. Substitua o bloco do título:

```tsx
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-bold",
                    step.done ? "text-slate-400 line-through" : "text-ink",
                  )}
                >
                  {meta.title}
                  {!step.done && <HelpHint label={`Sobre: ${meta.title}`}>{meta.help}</HelpHint>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{meta.description}</p>
              </div>
```

**Step 4: Verificar tipos e lint**

Run: `npx tsc --noEmit`
Expected: sem erros (o `Record<OnboardingStepKey, …>` agora exige a chave `ramo` — garantida pela entrada acima).
Run: `npx vitest run src/server/services/onboarding.service.test.ts`
Expected: PASS (nada quebrou no service).

**Step 5: Commit**

```bash
git add src/components/OnboardingChecklist.tsx src/components/VerticalOnboardingWizard.tsx
git commit -m "feat(onboarding): passo 'ramo' no checklist + nota de ajuda '?' por passo"
```

---

## Frente C — Gates contextuais (empty-state por recurso, sem trancar o app)

### Task C1: Componente reutilizável `SetupRequired`

**Files:**
- Create: `src/components/app/SetupRequired.tsx`
- Test: `src/components/app/SetupRequired.test.tsx`

**Step 1: Escrever o teste que falha**

Crie [SetupRequired.test.tsx](../../src/components/app/SetupRequired.test.tsx):

```typescript
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupRequired } from "./SetupRequired";

describe("SetupRequired", () => {
  it("mostra título, descrição e CTA quando canSettings", () => {
    const html = renderToStaticMarkup(
      <SetupRequired
        title="Conecte um número"
        description="Precisa de um chip pareado."
        href="/empresas"
        cta="Conectar"
        canSettings
      />,
    );
    expect(html).toContain("Conecte um número");
    expect(html).toContain("/empresas");
    expect(html).toContain("Conectar");
  });

  it("sem canSettings esconde o CTA e mostra aviso passivo", () => {
    const html = renderToStaticMarkup(
      <SetupRequired
        title="Conecte um número"
        description="Precisa de um chip pareado."
        href="/empresas"
        cta="Conectar"
        canSettings={false}
      />,
    );
    expect(html).not.toContain("/empresas");
    expect(html).toContain("administrador"); // texto passivo
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/app/SetupRequired.test.tsx`
Expected: FAIL — módulo não existe.

**Step 3: Implementar**

Crie [SetupRequired.tsx](../../src/components/app/SetupRequired.tsx):

```tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * Empty-state de "falta configurar X". Substitui a tela de uma rota cujo
 * pré-requisito duro não foi cumprido (ex.: inbox sem número). NÃO é um portão
 * global: bloqueia só a ação que não funcionaria, aponta o caminho e — para
 * quem não tem permissão — mostra um aviso passivo em vez do CTA. Fail-open por
 * design ([[reorganizacao-navegacao-feito]]).
 */
export function SetupRequired({
  icon: Icon,
  title,
  description,
  href,
  cta,
  canSettings,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  canSettings: boolean;
}) {
  return (
    <Card className="mx-auto max-w-md">
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        {Icon && (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-inset text-brand-500">
            <Icon size={22} />
          </span>
        )}
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
        {canSettings ? (
          <Link
            href={href}
            className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            {cta} <ArrowRight size={16} />
          </Link>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            Peça ao administrador da conta para concluir esta configuração.
          </p>
        )}
      </div>
    </Card>
  );
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/components/app/SetupRequired.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/app/SetupRequired.tsx src/components/app/SetupRequired.test.tsx
git commit -m "feat(app): SetupRequired — empty-state de pré-requisito por recurso"
```

---

### Task C2: Gate do `/inbox` (precisa de ≥1 número conectado)

**Files:**
- Modify: `src/app/(app)/inbox/page.tsx`

**Step 1: Aplicar o gate no server component**

Substitua [inbox/page.tsx](<../../src/app/(app)/inbox/page.tsx>) por:

```tsx
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { InboxView } from "@/components/inbox/InboxView";
import { SetupRequired } from "@/components/app/SetupRequired";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  // Gate contextual: sem número conectado, o Atendimento não tem por onde
  // receber/enviar. Bloqueia só ESTA tela (não o app), apontando o caminho.
  const numbers = await prisma.whatsAppNumber.count({ where: { userId: ctx.tenantUserId } });
  if (numbers === 0) {
    return (
      <SetupRequired
        icon={MessageSquare}
        title="Conecte um número para atender"
        description="O Atendimento precisa de um WhatsApp conectado para receber e responder mensagens."
        href="/empresas"
        cta="Conectar número"
        canSettings={ctx.perms.canSettings}
      />
    );
  }

  return <InboxView canSettings={ctx.perms.canSettings} />;
}
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Verificar manualmente (ver Task D1) — sem teste unitário aqui**

Server components de página não têm teste unitário no projeto; a verificação é o smoke do Task D1.

**Step 4: Commit**

```bash
git add "src/app/(app)/inbox/page.tsx"
git commit -m "feat(inbox): gate contextual — pede número conectado antes de atender"
```

---

### Task C3: Gate da `/agenda` (precisa de profissional + serviço)

**Files:**
- Modify: `src/app/(app)/agenda/page.tsx`

**Step 1: Aplicar o gate usando o `getBookingReadiness` que já existe**

Em [agenda/page.tsx](<../../src/app/(app)/agenda/page.tsx>), a página já calcula `bookingReadiness` (`{ hasProfessionalWithHours, hasBookableService, ready }`). Adote o gate SÓ quando o operador PODE configurar mas ainda não há chão para a agenda funcionar — para quem já configurou, ou quem não pode configurar, segue o fluxo normal (`AgendaView` já orienta internamente). Ajuste o final da função:

```tsx
import { getTenantContext } from "@/lib/tenant";
import { getBookingSettings, getBookingReadiness } from "@/server/services/booking-settings.service";
import { env } from "@/lib/env";
import { CalendarClock } from "lucide-react";
import { AgendaView } from "@/components/AgendaView";
import { SetupRequired } from "@/components/app/SetupRequired";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const ctx = await getTenantContext();
  if (!ctx) return <AgendaView />;

  const canSettings = ctx.perms.canSettings;
  const ownerId = ctx.tenantUserId;
  const [bookingSettings, bookingReadiness] = await Promise.all([
    getBookingSettings(ownerId),
    getBookingReadiness(ownerId),
  ]);

  // Gate contextual: sem profissional com expediente e serviço com duração, a
  // agenda não tem o que oferecer. Mostra o caminho a quem pode configurar;
  // quem não pode cai no fluxo normal (AgendaView já é passiva e informativa).
  if (canSettings && !bookingReadiness.ready) {
    return (
      <SetupRequired
        icon={CalendarClock}
        title="Prepare sua agenda"
        description="Cadastre ao menos um profissional com expediente e um serviço com duração para começar a marcar horários."
        href="/agenda?config=1"
        cta="Configurar agenda"
        canSettings
      />
    );
  }

  const publicUrl = bookingSettings.publicSlug
    ? `${env.APP_URL}/agendar/${bookingSettings.publicSlug}`
    : null;

  return (
    <AgendaView
      config={{
        canSettings,
        booking: {
          initial: { ...bookingSettings, publicUrl },
          readiness: bookingReadiness,
        },
      }}
    />
  );
}
```

> **Verifique o CTA:** o `href="/agenda?config=1"` precisa abrir a aba de configuração da `AgendaView`. Cheque em [AgendaView.tsx](../../src/components/AgendaView.tsx) como a aba "Configurar" é ativada. Se ela NÃO lê um query param, ajuste o `href` para o mecanismo real (ex.: uma âncora existente) OU deixe `href="/agenda"` e confie no `AgendaView` para mostrar o config quando `canSettings`. Não invente um param que a view ignora.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add "src/app/(app)/agenda/page.tsx"
git commit -m "feat(agenda): gate contextual — pede profissional+serviço antes de marcar"
```

---

## Frente D — Verificação end-to-end

### Task D1: Smoke visual do fluxo completo

**Files:** nenhum (verificação).

**Step 1: Subir o app**

Pré-requisito: Docker do Postgres de dev no ar ([[local-dev-db-docker]]). Pare o `next dev` antes de qualquer `prisma generate` para evitar EPERM ([[prisma-generate-dev-server-lock]]).

Run: `npm run dev`

**Step 2: Checklist ciente do ramo**

- Entre com uma conta SEM ramo definido → em `/leads`, o card "Primeiros passos" mostra **"Escolha o seu ramo de negócio"** como 1º passo, com ícone de loja e uma nota **"?"** que abre ao clicar.
- Clique no **"?"** de alguns passos → o texto de ajuda abre/fecha (teste no navegador em largura mobile: deve abrir por toque, sem depender de hover).
- Clique em **"Escolher ramo"** → cai em `/configuracoes` e rola até o card do wizard (âncora `#configuracao-rapida-ramo`).
- Aplique um ramo SEM agenda (ex.: **Borracharia**) → volte a `/leads`: o passo **"Agende sua primeira reunião"** NÃO aparece; o passo "ramo" agora está com check verde.
- Aplique um ramo COM agenda (ex.: **Salão de beleza**) → o passo "Agende sua primeira reunião" reaparece.

**Step 3: Gates contextuais**

- Com uma conta SEM número conectado, acesse `/inbox` → aparece o empty-state **"Conecte um número para atender"** com CTA (se você for dono/admin) ou aviso passivo (se operador sem `canSettings`).
- Conecte um número → `/inbox` volta a mostrar o `InboxView` normal.
- Com agenda sem profissional/serviço e sendo dono, acesse `/agenda` → empty-state **"Prepare sua agenda"**. Cadastre profissional+serviço → a agenda normal volta.
- **Confirme o fail-open:** digitar a URL direto NÃO deve dar erro nem loop — só troca a tela pelo empty-state, e o menu lateral continua todo acessível.

**Step 4: Suíte de testes + tipos + lint**

Run: `npm test`
Expected: verde (incluindo os novos testes do onboarding, HelpHint e SetupRequired).
Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm run lint`
Expected: sem erros novos.

**Step 5: Commit final (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "test(onboarding): smoke do fluxo guiado por ramo + gates contextuais"
```

---

## Notas, riscos e não-objetivos

- **Sem schema.** Nada de migration — `businessTemplateId`, `WhatsAppNumber`, `Professional`, `WorkingHours` já existem. Deploy é só de código.
- **Fail-open é regra, não exceção.** Nenhum gate pode causar redirect global nem loop. Rota sempre renderiza *algo* (a tela ou o empty-state). Coerente com [[reorganizacao-navegacao-feito]].
- **Contas existentes (cartório) não quebram.** O passo "ramo" apenas fica "não concluído" no checklist até escolherem um; não bloqueia acesso. Os gates de inbox/agenda só disparam se o pré-requisito real faltar — uma conta em produção com número conectado nunca vê o gate do inbox.
- **`category` null ⇒ tudo aparece.** Quem não definiu ramo continua vendo todos os passos (inclusive agenda) — `moduleVisibleFor` é fail-open. Isso é intencional: não escondemos capacidade de quem ainda não se declarou.
- **DRY:** `moduleVisibleFor` é reusado (menu + onboarding), `SetupRequired` e `HelpHint` são genéricos para adoção futura (ex.: gate de `/estoque`, `/campaigns`).
- **YAGNI / não-objetivos:** NÃO criamos rota `/comecar` dedicada, NÃO movemos o wizard para fora de Configurações (só o linkamos), NÃO adicionamos gate a `/estoque`/`/catalogo`/`/campaigns` nesta rodada (o padrão fica pronto para isso depois), NÃO tornamos o onboarding obrigatório/modal-bloqueante.
- **Ponto de atenção do Task C3:** confirme o mecanismo real de abrir a config da `AgendaView` antes de fixar o `href` — não presuma um query param inexistente.
- **Ponto de atenção do Task B2:** confirme se `Card` repassa `id`; se não, use um `<div id=…>` wrapper.
