# Modelos de Negócio por Segmento — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar ao usuário um catálogo de "modelos de negócio" prontos (oficina, clínica, salão, advocacia, restaurante, etc.) que, ao serem aplicados, pré-preenchem a config de atendimento de um número (persona + base de conhecimento estruturada + horário + instruções + toggles sugeridos) — transformando o setup de "escrever tudo do zero" em "escolher o ramo e preencher os `[colchetes]`".

**Architecture:** Os modelos são um **catálogo estático em código** (`src/lib/business-templates.ts`), não dados de banco — são conteúdo versionado, iguais para todos os tenants, sem migração e sem novo endpoint. "Aplicar modelo" é uma **função pura de merge** (`applyTemplate`) que preenche o estado do formulário de Atendimento no client; o salvamento continua usando o `PATCH /api/numbers/[id]` existente. Nenhuma mudança no runtime da IA (o modelo só popula os campos que o [`buildAttendanceContext`](../../src/server/ai/attendance-context.ts) já consome). O valor está no **esqueleto de base de conhecimento** por vertical — seções e `[placeholders]` que ensinam o usuário exatamente que informação a IA precisa.

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 19, Vitest (testes colocados `*.test.ts`, alias `@/`), Prisma 6 (só na fase opcional). Sem novas dependências.

---

## Decisões de design (e não-objetivos)

- **Catálogo em código, não no banco.** Segue a filosofia do projeto (prompts centralizados em [`src/server/ai/prompts.ts`](../../src/server/ai/prompts.ts)). Evita migração/`db push` (que está com pendências de prod) e mantém a API intacta. Trade-off aceito: adicionar/editar um modelo exige deploy — ok, é raro e é conteúdo.
- **Aplicar = merge no formulário, não auto-save.** Aplicar um modelo **nunca** grava direto no banco nem sobrescreve config silenciosamente. Ele preenche o estado do modal; o usuário revisa, troca os `[placeholders]` e clica em "Salvar atendimento" (fluxo atual). Se algum campo de texto já tiver conteúdo, pedimos confirmação antes de sobrescrever.
- **Toggles são sugeridos e clampados por plano.** Um modelo pode sugerir ligar "Qualificar"/"Agendar"/"Modo vendas", mas esses são gateados. O merge só liga o que o plano permite (reusa o padrão de `salesAllowed`; adicionamos `qualifyAllowed`/`scheduleAllowed` ao payload de `/api/numbers`). O `assertFeature` no save continua sendo a rede de segurança.
- **`displayName` fica com o usuário.** O modelo não chuta o nome da empresa; ele deixa isso como `[placeholder]` na base e no campo "Nome de exibição".
- **`systemPromptOverride` fica intacto.** O modo "prompt mestre" é avançado e substitui tudo; modelos operam na camada persona+base, então **não** tocam no override. Se houver override preenchido, o modal avisa que o modelo será ignorado pela IA.
- **Não-objetivo (core):** persistir qual modelo foi aplicado, analytics por vertical, e criar ofertas automaticamente. Tudo isso vai para a **Fase 9 (opcional)**, que exige migração e está claramente sinalizada.
- **Cobertura ("máximo de tipos"):** ~50 modelos em 12 categorias (ver Apêndice A). As Fases 5–8 populam o catálogo por categoria; cada modelo é uma tarefa mecânica repetível seguindo o padrão da Fase 4.

## Mapa de arquivos

- **Criar:** `src/lib/business-templates.ts` — tipos + `applyTemplate` + catálogo.
- **Criar:** `src/lib/business-templates.test.ts` — testes do merge + integridade do catálogo.
- **Criar:** `src/components/BusinessTemplatePicker.tsx` — seletor (categoria → modelo) + botão aplicar.
- **Modificar:** [`src/components/WhatsAppNumbersPanel.tsx`](../../src/components/WhatsAppNumbersPanel.tsx) — embutir o picker no topo do modal de Atendimento; consumir `qualifyAllowed`/`scheduleAllowed`.
- **Modificar:** `src/app/api/numbers/route.ts` (GET) — expor `qualifyAllowed`/`scheduleAllowed` no payload.
- **Modificar:** [`docs/onboarding-assistido.md`](../../docs/onboarding-assistido.md) — mencionar os modelos no passo da IA.
- **(Fase 9, opcional)** [`prisma/schema.prisma`](../../prisma/schema.prisma) — `businessTemplateId String?` em `WhatsAppNumber`.

---

## Fase 0 — Fundação: tipos + `applyTemplate` (TDD, sem catálogo ainda)

Constrói a lógica pura primeiro, com testes. Nenhuma UI, nenhum dado real de modelo.

### Task 0.1: Definir os tipos e o esqueleto do módulo

**Files:**
- Create: `src/lib/business-templates.ts`

**Step 1: Escrever os tipos e a assinatura (sem catálogo).**

```ts
// src/lib/business-templates.ts
/**
 * Catálogo estático de "modelos de negócio". Cada modelo pré-preenche a config
 * de atendimento de um número (número = empresa). É CONTEÚDO versionado em
 * código — não é dado de tenant. O ouro está no `knowledgeBase`: um esqueleto
 * com seções + [placeholders] que ensina o usuário o que a IA precisa saber.
 */

export type BusinessCategory =
  | "saude"
  | "beleza"
  | "automotivo"
  | "casa"
  | "educacao"
  | "alimentacao"
  | "varejo"
  | "servicos-pro"
  | "fitness"
  | "eventos"
  | "imoveis-turismo"
  | "outro";

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  saude: "Saúde & Bem-estar",
  beleza: "Beleza & Cuidados",
  automotivo: "Automotivo",
  casa: "Serviços residenciais",
  educacao: "Educação",
  alimentacao: "Alimentação",
  varejo: "Comércio & Varejo",
  "servicos-pro": "Serviços profissionais",
  fitness: "Fitness & Esporte",
  eventos: "Eventos & Foto",
  "imoveis-turismo": "Imóveis & Turismo",
  outro: "Outro / Genérico",
};

/** Toggles de funcionalidade que um modelo recomenda ligar. */
export interface TemplateSuggestedToggles {
  autoReply: boolean;
  qualify: boolean;
  schedule: boolean;
  sales: boolean;
}

/** Oferta sugerida (só dica textual; criação real fica na Fase 9). */
export interface TemplateSuggestedOffer {
  name: string;
  description?: string;
  priceHint?: string; // ex.: "a partir de R$ 150"
}

export interface BusinessTemplate {
  id: string; // kebab estável, ex.: "oficina-mecanica"
  category: BusinessCategory;
  label: string; // "Oficina mecânica"
  blurb: string; // 1 linha do que é o ramo
  persona: string; // preenche `persona`
  businessHours: string; // sugestão de horário
  knowledgeBase: string; // ESQUELETO com [placeholders]
  customInstructions: string; // regras específicas da vertical
  suggested: TemplateSuggestedToggles;
  suggestedOffers?: TemplateSuggestedOffer[];
}

/** Campos do formulário de Atendimento que um modelo consegue preencher. */
export interface TemplateApplyTarget {
  persona: string;
  businessHours: string;
  knowledgeBase: string;
  customInstructions: string;
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
  salesEnabled: boolean;
}

/** O que o plano libera (clampa os toggles sugeridos). */
export interface TemplateAllow {
  qualify: boolean;
  schedule: boolean;
  sales: boolean;
}

// Catálogo — populado nas Fases 1/4/5-8.
export const BUSINESS_TEMPLATES: BusinessTemplate[] = [];

export function getTemplate(id: string): BusinessTemplate | undefined {
  return BUSINESS_TEMPLATES.find((t) => t.id === id);
}

/** Há algum campo de texto já preenchido no alvo? (decide o "sobrescrever?") */
export function hasTextContent(target: TemplateApplyTarget): boolean {
  return Boolean(
    target.persona.trim() ||
      target.knowledgeBase.trim() ||
      target.businessHours.trim() ||
      target.customInstructions.trim(),
  );
}

/**
 * Merge PURO do modelo sobre o estado atual do formulário.
 * - Texto: preenche quando `overwriteText` OU quando o campo atual está vazio.
 * - Toggles: OR com o sugerido, mas clampado pelo que o plano permite.
 *   `autoReply` não é gateado.
 */
export function applyTemplate(
  current: TemplateApplyTarget,
  tpl: BusinessTemplate,
  opts: { overwriteText: boolean; allow: TemplateAllow },
): TemplateApplyTarget {
  const fill = (cur: string, next: string) =>
    opts.overwriteText || !cur.trim() ? next : cur;
  return {
    persona: fill(current.persona, tpl.persona),
    businessHours: fill(current.businessHours, tpl.businessHours),
    knowledgeBase: fill(current.knowledgeBase, tpl.knowledgeBase),
    customInstructions: fill(current.customInstructions, tpl.customInstructions),
    autoReplyEnabled: current.autoReplyEnabled || tpl.suggested.autoReply,
    qualifyEnabled: current.qualifyEnabled || (tpl.suggested.qualify && opts.allow.qualify),
    scheduleEnabled: current.scheduleEnabled || (tpl.suggested.schedule && opts.allow.schedule),
    salesEnabled: current.salesEnabled || (tpl.suggested.sales && opts.allow.sales),
  };
}
```

**Step 2: Verificar que compila.**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit.**

```bash
git add src/lib/business-templates.ts
git commit -m "feat(modelos): tipos e applyTemplate (catálogo vazio)"
```

### Task 0.2: Testes de `applyTemplate` e helpers (TDD)

**Files:**
- Create: `src/lib/business-templates.test.ts`

**Step 1: Escrever os testes (devem falhar por catálogo vazio? não — testam a função pura com um modelo dummy).**

```ts
import { describe, it, expect } from "vitest";
import {
  applyTemplate,
  hasTextContent,
  type BusinessTemplate,
  type TemplateApplyTarget,
} from "./business-templates";

const DUMMY: BusinessTemplate = {
  id: "dummy",
  category: "outro",
  label: "Dummy",
  blurb: "teste",
  persona: "persona-do-modelo",
  businessHours: "Seg–Sex 9h–18h",
  knowledgeBase: "base-do-modelo [preencha]",
  customInstructions: "instr-do-modelo",
  suggested: { autoReply: true, qualify: true, schedule: true, sales: true },
};

const EMPTY: TemplateApplyTarget = {
  persona: "",
  businessHours: "",
  knowledgeBase: "",
  customInstructions: "",
  autoReplyEnabled: false,
  qualifyEnabled: false,
  scheduleEnabled: false,
  salesEnabled: false,
};

const ALLOW_ALL = { qualify: true, schedule: true, sales: true };

describe("applyTemplate", () => {
  it("preenche campos vazios com o conteúdo do modelo", () => {
    const out = applyTemplate(EMPTY, DUMMY, { overwriteText: false, allow: ALLOW_ALL });
    expect(out.persona).toBe("persona-do-modelo");
    expect(out.knowledgeBase).toContain("[preencha]");
    expect(out.businessHours).toBe("Seg–Sex 9h–18h");
  });

  it("NÃO sobrescreve texto já preenchido quando overwriteText=false", () => {
    const cur = { ...EMPTY, persona: "meu texto" };
    const out = applyTemplate(cur, DUMMY, { overwriteText: false, allow: ALLOW_ALL });
    expect(out.persona).toBe("meu texto");
    expect(out.knowledgeBase).toBe("base-do-modelo [preencha]"); // vazio → preenche
  });

  it("sobrescreve tudo quando overwriteText=true", () => {
    const cur = { ...EMPTY, persona: "meu texto" };
    const out = applyTemplate(cur, DUMMY, { overwriteText: true, allow: ALLOW_ALL });
    expect(out.persona).toBe("persona-do-modelo");
  });

  it("clampa toggles sugeridos pelo que o plano permite", () => {
    const out = applyTemplate(EMPTY, DUMMY, {
      overwriteText: false,
      allow: { qualify: true, schedule: false, sales: false },
    });
    expect(out.qualifyEnabled).toBe(true);
    expect(out.scheduleEnabled).toBe(false); // sugerido mas não permitido
    expect(out.salesEnabled).toBe(false);
    expect(out.autoReplyEnabled).toBe(true); // autoReply não é gateado
  });

  it("nunca DESLIGA um toggle já ligado", () => {
    const cur = { ...EMPTY, scheduleEnabled: true };
    const off = { ...DUMMY, suggested: { autoReply: false, qualify: false, schedule: false, sales: false } };
    const out = applyTemplate(cur, off, { overwriteText: true, allow: ALLOW_ALL });
    expect(out.scheduleEnabled).toBe(true);
  });
});

describe("hasTextContent", () => {
  it("false quando tudo vazio/whitespace", () => {
    expect(hasTextContent(EMPTY)).toBe(false);
    expect(hasTextContent({ ...EMPTY, persona: "   " })).toBe(false);
  });
  it("true quando algum campo de texto tem conteúdo", () => {
    expect(hasTextContent({ ...EMPTY, knowledgeBase: "x" })).toBe(true);
  });
});
```

**Step 2: Rodar e confirmar que passam.**

Run: `npx vitest run src/lib/business-templates.test.ts`
Expected: PASS (todos os testes verdes).

**Step 3: Commit.**

```bash
git add src/lib/business-templates.test.ts
git commit -m "test(modelos): cobre applyTemplate e hasTextContent"
```

---

## Fase 1 — Catálogo: 2 modelos exemplares + teste de integridade

Popula o catálogo com 2 modelos completos (uma oficina e uma clínica odontológica) que servem de **padrão de referência** para todos os demais. Adiciona um teste que valida a integridade do catálogo inteiro (ids únicos, campos obrigatórios).

### Task 1.1: Adicionar os 2 modelos exemplares

**Files:**
- Modify: `src/lib/business-templates.ts` (preencher `BUSINESS_TEMPLATES`)

**Step 1: Substituir `export const BUSINESS_TEMPLATES: BusinessTemplate[] = [];` pelos 2 modelos.**

```ts
export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
  {
    id: "oficina-mecanica",
    category: "automotivo",
    label: "Oficina mecânica",
    blurb: "Manutenção e reparo de veículos, orçamentos e agendamento.",
    persona:
      "Atendente de oficina, direto e confiável. Fala simples, sem jargão técnico pesado, passa segurança e nunca promete o que a oficina não confirmou.",
    businessHours: "Seg–Sex 8h às 18h, Sáb 8h às 12h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS (a partir de)",
      "- Troca de óleo + filtro: R$ [preço]",
      "- Alinhamento e balanceamento: R$ [preço]",
      "- Revisão completa: R$ [preço]",
      "- Diagnóstico eletrônico (scanner): R$ [preço] (ou grátis na execução do serviço?)",
      "- Troca de pastilhas de freio: R$ [preço]",
      "",
      "O QUE ATENDEMOS",
      "- Marcas/tipos: [ex.: nacionais e importados, carros de passeio; motos? não]",
      "",
      "COMO FUNCIONA",
      "- Orçamento: [gratuito e sem compromisso]",
      "- Prazo médio: [ex.: serviços simples no mesmo dia]",
      "- Garantia: [ex.: 90 dias no serviço]",
      "- Peças: [usa peça original/genuína? cliente pode trazer a peça?]",
      "",
      "ENDEREÇO E CONTATO",
      "- Endereço: [rua, número, bairro, cidade]",
      "- Estacionamento/leva-e-traz: [sim/não]",
      "",
      "PAGAMENTO",
      "- Formas: [dinheiro, Pix, cartão em até Nx]",
    ].join("\n"),
    customInstructions:
      "Se o cliente descrever um problema (barulho, luz no painel, vibração), NÃO diagnostique à distância nem chute preço fechado: explique que precisa passar pela oficina para avaliação e ofereça agendar. Sempre confirme marca/modelo/ano do veículo antes de estimar prazo.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "clinica-odontologica",
    category: "saude",
    label: "Clínica odontológica",
    blurb: "Consultório/clínica de odontologia — avaliações e procedimentos.",
    persona:
      "Recepcionista de clínica odontológica, acolhedora e profissional. Passa confiança e cuidado, linguagem clara, sem termos clínicos complexos.",
    businessHours: "Seg–Sex 9h às 19h, Sáb 9h às 13h",
    knowledgeBase: [
      "SERVIÇOS",
      "- Avaliação inicial: [gratuita / R$ preço]",
      "- Limpeza (profilaxia): R$ [preço]",
      "- Clareamento: a partir de R$ [preço]",
      "- Restauração / obturação: a partir de R$ [preço]",
      "- Ortodontia (aparelho): manutenção R$ [preço]/mês; instalação R$ [preço]",
      "- Implante: a partir de R$ [preço]",
      "",
      "CONVÊNIOS E PAGAMENTO",
      "- Convênios aceitos: [liste ou 'não trabalhamos com convênio']",
      "- Formas: [Pix, cartão, parcelamento em Nx]",
      "",
      "EQUIPE E ESTRUTURA",
      "- Especialidades: [ex.: clínico geral, ortodontia, implantodontia]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade] — referência: [ponto de referência]",
    ].join("\n"),
    customInstructions:
      "NUNCA dê diagnóstico ou conduta clínica pelo WhatsApp (ex.: 'é cárie', 'precisa extrair'). Para qualquer queixa, oriente agendar uma avaliação. Em caso de dor forte/urgência, priorize oferecer o horário mais próximo.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
];
```

**Step 2: Compilar.**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit.**

```bash
git add src/lib/business-templates.ts
git commit -m "feat(modelos): modelos exemplares (oficina, odontologia)"
```

### Task 1.2: Teste de integridade do catálogo

**Files:**
- Modify: `src/lib/business-templates.test.ts` (adicionar bloco)

**Step 1: Adicionar ao arquivo de teste.**

```ts
import { BUSINESS_TEMPLATES, CATEGORY_LABEL, type BusinessCategory } from "./business-templates";

describe("catálogo BUSINESS_TEMPLATES", () => {
  it("tem ids únicos e em kebab-case", () => {
    const ids = BUSINESS_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("todo modelo tem campos obrigatórios não-vazios e categoria válida", () => {
    for (const t of BUSINESS_TEMPLATES) {
      expect(t.label.trim()).not.toBe("");
      expect(t.blurb.trim()).not.toBe("");
      expect(t.persona.trim()).not.toBe("");
      expect(t.knowledgeBase.trim()).not.toBe("");
      expect(CATEGORY_LABEL[t.category as BusinessCategory]).toBeDefined();
    }
  });
});
```

**Step 2: Rodar.**

Run: `npx vitest run src/lib/business-templates.test.ts`
Expected: PASS.

**Step 3: Commit.**

```bash
git add src/lib/business-templates.test.ts
git commit -m "test(modelos): integridade do catálogo (ids únicos, campos)"
```

---

## Fase 2 — Backend: expor `qualifyAllowed`/`scheduleAllowed`

O client precisa saber o que o plano libera para clampar os toggles do modelo (hoje só recebe `salesAllowed`/`allowStrongModel`). Espelha o padrão existente.

### Task 2.1: Adicionar as flags ao GET `/api/numbers`

**Files:**
- Modify: `src/app/api/numbers/route.ts` (handler GET)

**Step 1:** Ler `src/app/api/numbers/route.ts` e localizar onde `salesAllowed` é calculado/retornado (provavelmente via `PLAN_LIMITS`/`assertFeature`/entitlements). Seguir o MESMO mecanismo para derivar `qualifyAllowed` e `scheduleAllowed` (checando `PLAN_LIMITS[plan].qualify` e `.schedule`, com grandfather/admin = true — exatamente como o service faz em [`numbers.service.ts:182-184`](../../src/server/services/numbers.service.ts#L182-L184)).

**Step 2:** Incluir `qualifyAllowed` e `scheduleAllowed` no `NextResponse.json({...})` ao lado de `salesAllowed`.

**Step 3: Compilar.**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4:** Se existir `src/app/api/numbers/route.test.ts`, adicionar/estender um caso que assevera as duas flags novas no payload. Rodar:

Run: `npx vitest run src/app/api/numbers/route.test.ts`
Expected: PASS.

**Step 5: Commit.**

```bash
git add src/app/api/numbers/route.ts src/app/api/numbers/route.test.ts
git commit -m "feat(numbers): expõe qualifyAllowed/scheduleAllowed no GET"
```

---

## Fase 3 — UI: seletor de modelo no modal de Atendimento

### Task 3.1: Componente `BusinessTemplatePicker`

**Files:**
- Create: `src/components/BusinessTemplatePicker.tsx`

**Step 1: Escrever o componente.** Dois selects encadeados (categoria → modelo) + botão "Aplicar modelo" + `blurb` do modelo selecionado. Ele NÃO faz merge; apenas devolve o `BusinessTemplate` escolhido via callback `onApply`.

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  BUSINESS_TEMPLATES,
  CATEGORY_LABEL,
  type BusinessCategory,
  type BusinessTemplate,
} from "@/lib/business-templates";

/** Categorias que realmente têm modelos, na ordem do CATEGORY_LABEL. */
function usedCategories(): BusinessCategory[] {
  const present = new Set(BUSINESS_TEMPLATES.map((t) => t.category));
  return (Object.keys(CATEGORY_LABEL) as BusinessCategory[]).filter((c) => present.has(c));
}

export function BusinessTemplatePicker({
  onApply,
}: {
  onApply: (tpl: BusinessTemplate) => void;
}) {
  const categories = useMemo(usedCategories, []);
  const [cat, setCat] = useState<BusinessCategory | "">("");
  const [tplId, setTplId] = useState("");

  const options = useMemo(
    () => (cat ? BUSINESS_TEMPLATES.filter((t) => t.category === cat) : []),
    [cat],
  );
  const selected = options.find((t) => t.id === tplId) ?? null;

  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-3">
      <p className="text-xs font-semibold text-slate-700">
        Começar por um modelo de negócio
      </p>
      <p className="text-xs text-slate-500">
        Escolha seu ramo para preencher persona, base de conhecimento e horário.
        Depois é só trocar os trechos entre <code>[colchetes]</code>.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select
          value={cat}
          onChange={(e) => {
            setCat(e.target.value as BusinessCategory | "");
            setTplId("");
          }}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">Categoria…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          value={tplId}
          onChange={(e) => setTplId(e.target.value)}
          disabled={!cat}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
        >
          <option value="">{cat ? "Ramo…" : "Escolha a categoria"}</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {selected && <p className="text-xs text-slate-500">{selected.blurb}</p>}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!selected}
          onClick={() => selected && onApply(selected)}
        >
          Aplicar modelo
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Compilar.**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit.**

```bash
git add src/components/BusinessTemplatePicker.tsx
git commit -m "feat(modelos): componente BusinessTemplatePicker"
```

### Task 3.2: Integrar o picker no modal de Atendimento

**Files:**
- Modify: [`src/components/WhatsAppNumbersPanel.tsx`](../../src/components/WhatsAppNumbersPanel.tsx)

**Step 1:** Importar o picker e `applyTemplate`/`hasTextContent`:

```tsx
import { BusinessTemplatePicker } from "@/components/BusinessTemplatePicker";
import { applyTemplate, hasTextContent, type BusinessTemplate } from "@/lib/business-templates";
```

**Step 2:** Adicionar estado para as flags novas (ao lado de `salesAllowed`, ~linha 100-102):

```tsx
const [qualifyAllowed, setQualifyAllowed] = useState(false);
const [scheduleAllowed, setScheduleAllowed] = useState(false);
```

E no `load()` (junto de `setSalesAllowed`, ~linha 141):

```tsx
setQualifyAllowed(Boolean(data.qualifyAllowed));
setScheduleAllowed(Boolean(data.scheduleAllowed));
```

**Step 3:** Adicionar o handler de aplicar modelo dentro do componente (perto de `openService`/`submitService`):

```tsx
function handleApplyTemplate(tpl: BusinessTemplate) {
  if (!service) return;
  const overwriteText = hasTextContent(service)
    ? window.confirm(
        "Você já preencheu alguns campos. Substituir persona, base de conhecimento e horário pelo modelo? (Cancelar mantém o que você escreveu e só preenche os campos vazios.)",
      )
    : false;
  const merged = applyTemplate(service, tpl, {
    overwriteText,
    allow: { qualify: qualifyAllowed, schedule: scheduleAllowed, sales: salesAllowed },
  });
  setService({ ...service, ...merged });
}
```

> Nota: `applyTemplate` recebe/retorna só o subconjunto `TemplateApplyTarget`. O `ServiceConfig` do painel é um superset (tem `displayName`, `aiModel`, delays, etc.), por isso o spread `{ ...service, ...merged }` preserva o resto. Os campos de `TemplateApplyTarget` batem em nome/tipo com os de `ServiceConfig` — confirmar no `tsc`.

**Step 4:** Renderizar o picker no topo do corpo do modal de Atendimento (logo após `{service && (` e antes do bloco "Nome de exibição", ~linha 673). Se houver `systemPromptOverride` preenchido, mostrar aviso de que o modelo será ignorado:

```tsx
<BusinessTemplatePicker onApply={handleApplyTemplate} />
{service.systemPromptOverride.trim() && (
  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
    Você tem um System prompt (avançado) preenchido — enquanto ele existir, a IA
    ignora persona/base/horário. Limpe-o para o modelo ter efeito.
  </p>
)}
```

**Step 5: Compilar + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

**Step 6:** Verificação manual (sub-skill `run` ou `npm run dev`): abrir Atendimento de um número → escolher categoria "Automotivo" → "Oficina mecânica" → "Aplicar modelo" → confirmar que persona/base/horário preenchem e o toggle "Agendar" liga (se o plano permitir). Testar o caminho de sobrescrita (campo já preenchido → confirm).

**Step 7: Commit.**

```bash
git add src/components/WhatsAppNumbersPanel.tsx
git commit -m "feat(modelos): picker de modelo dentro do modal de Atendimento"
```

---

## Fase 4 — Padrão de autoria de um modelo (referência para as Fases 5–8)

Não há código novo aqui — é a **receita** que cada tarefa de "adicionar modelo X" segue. Cada modelo é ~5 min de trabalho mecânico.

**Para cada modelo:**
1. Adicionar um objeto `BusinessTemplate` ao array `BUSINESS_TEMPLATES` seguindo o padrão da Fase 1.
2. `knowledgeBase`: sempre montar via `[...].join("\n")` com **SEÇÕES EM CAIXA ALTA** e `[placeholders]` — cobrir: serviços/produtos + preços, como funciona (prazo/garantia/política), endereço/contato, pagamento. Adaptar as seções ao ramo.
3. `customInstructions`: a **regra de segurança da vertical** (ex.: saúde não diagnostica; automotivo não chuta preço; advocacia não dá parecer jurídico).
4. `suggested`: `autoReply` quase sempre `true`. `schedule: true` para negócios de hora marcada (saúde, beleza, fitness). `sales: true` só onde faz sentido cobrar por Pix no chat (cursos, produtos, mentorias). `qualify: true` para ticket alto/B2B (advocacia, imóveis, arquitetura, consultoria).
5. Rodar `npx vitest run src/lib/business-templates.test.ts` — o teste de integridade pega id duplicado/campo vazio.
6. Commit por categoria (não por modelo individual) para não poluir o histórico.

**Checklist de qualidade por modelo:**
- [ ] `id` único, kebab-case, estável (não renomear depois — é a "chave").
- [ ] `persona` descreve tom + limites em 1–2 frases.
- [ ] `knowledgeBase` tem ≥ 4 seções e nenhum dado inventado (só `[placeholders]`).
- [ ] `customInstructions` traz a salvaguarda da vertical.
- [ ] `suggested` coerente com o ramo.

---

## Fase 5 — Catálogo: Saúde, Beleza, Automotivo

Adiciona todos os modelos dessas 3 categorias (menos os 2 exemplares já feitos). Ver Apêndice A para a lista.

### Task 5.1: Saúde & Bem-estar
Adicionar: `clinica-medica`, `clinica-estetica`, `fisioterapia`, `psicologia`, `nutricionista`, `clinica-veterinaria`, `laboratorio-exames`.
`suggested` típico: `{ autoReply: true, qualify: false, schedule: true, sales: false }`. Salvaguarda comum: **não dar diagnóstico/conduta clínica** pelo chat.
Commit: `feat(modelos): categoria Saúde`

### Task 5.2: Beleza & Cuidados
Adicionar: `salao-beleza`, `barbearia`, `studio-sobrancelha-cilios`, `estudio-tatuagem`, `spa-massagem`, `manicure-nail-designer`.
`suggested` típico: `schedule: true`. Salvaguarda: confirmar procedimento/tempo antes de reservar horário.
Commit: `feat(modelos): categoria Beleza`

### Task 5.3: Automotivo
Adicionar: `funilaria-pintura`, `auto-eletrica`, `revenda-veiculos`, `estetica-automotiva-lavarapido`, `locadora-veiculos`, `borracharia`.
Salvaguarda: **não fechar preço de reparo sem avaliação**.
Commit: `feat(modelos): categoria Automotivo`

**Ao fim de cada task:** `npx vitest run src/lib/business-templates.test.ts` (PASS) + `npx tsc --noEmit`.

---

## Fase 6 — Catálogo: Serviços residenciais, Educação, Alimentação

### Task 6.1: Serviços residenciais
Adicionar: `dedetizadora`, `limpeza-diarista`, `eletricista`, `encanador`, `ar-condicionado`, `marido-de-aluguel`, `jardinagem-paisagismo`, `chaveiro`.
`suggested`: normalmente `schedule: true` (visita técnica); `sales: false`. Salvaguarda: orçamento depende de visita/avaliação.
Commit: `feat(modelos): categoria Serviços residenciais`

### Task 6.2: Educação
Adicionar: `escola-idiomas`, `curso-profissionalizante`, `autoescola-cfc`, `escola-infantil`, `reforco-professor-particular`.
`suggested`: `qualify: true` (interesse do aluno/responsável), `sales: true` para cursos vendidos no chat.
Commit: `feat(modelos): categoria Educação`

### Task 6.3: Alimentação
Adicionar: `restaurante-delivery`, `pizzaria-hamburgueria`, `confeitaria-bolos`, `buffet-eventos`.
Salvaguarda: confirmar itens/quantidade/endereço de entrega; nunca inventar cardápio/preço.
Commit: `feat(modelos): categoria Alimentação`

---

## Fase 7 — Catálogo: Varejo, Serviços profissionais, Fitness

### Task 7.1: Comércio & Varejo
Adicionar: `loja-roupas-moda`, `otica`, `moveis-decoracao`, `materiais-construcao`, `petshop-produtos`, `distribuidora-atacado`.
`suggested`: `sales: true` onde cabe cobrança por Pix.
Commit: `feat(modelos): categoria Varejo`

### Task 7.2: Serviços profissionais (B2B / ticket alto)
Adicionar: `advocacia`, `contabilidade`, `corretor-imoveis`, `corretor-seguros`, `agencia-marketing`, `arquitetura-design-interiores`.
`suggested`: `qualify: true`, `schedule: true`. Salvaguarda: **advocacia/contabilidade não dão parecer/consultoria** pelo chat — orientam consulta.
Commit: `feat(modelos): categoria Serviços profissionais`

### Task 7.3: Fitness & Esporte
Adicionar: `academia`, `personal-trainer`, `pilates-yoga`, `crossfit`, `escola-natacao`.
`suggested`: `schedule: true` (aula experimental), `sales: true` (planos/mensalidades).
Commit: `feat(modelos): categoria Fitness`

---

## Fase 8 — Catálogo: Eventos, Imóveis & Turismo, Genérico

### Task 8.1: Eventos & Foto
Adicionar: `fotografia-filmagem`, `decoracao-festas`, `aluguel-equipamentos-festa`, `cerimonial-casamento`.
`suggested`: `qualify: true` (data/tipo de evento), `schedule: true`.
Commit: `feat(modelos): categoria Eventos`

### Task 8.2: Imóveis & Turismo
Adicionar: `imobiliaria`, `agencia-viagens`.
`suggested`: `qualify: true` (perfil/orçamento), `schedule: true` (visita).
Commit: `feat(modelos): categoria Imóveis e Turismo`

### Task 8.3: Genérico (fallback)
Adicionar: `atendimento-generico` — persona neutra, base com seções genéricas (o que oferecemos, como funciona, contato, pagamento). É o "não achei meu ramo".
Commit: `feat(modelos): modelo genérico (fallback)`

**Ao fim da Fase 8:** o teste de integridade cobre todos; rodar a suíte inteira: `npm test` (PASS).

---

## Fase 9 — (Opcional) Persistir o modelo aplicado + ofertas sugeridas

⚠️ **Requer migração de banco (`db push`/`migrate`).** As notas de projeto indicam pendências no fluxo de migração em prod — **NÃO** executar contra prod sem alinhar o cutover. Fazer só em dev/local a menos que explicitamente autorizado.

### Task 9.1: Campo `businessTemplateId`
**Files:** [`prisma/schema.prisma`](../../prisma/schema.prisma), `src/app/api/numbers/[id]/route.ts`, `src/server/services/numbers.service.ts`, `src/server/services/numbers.service.ts` (list select) + tipos correlatos.
- Adicionar `businessTemplateId String?` em `WhatsAppNumber` (comentário: qual modelo foi aplicado; só rótulo/UX).
- Incluir no `updateSchema` (zod), no `patch` do service, no `select` do `listWhatsAppNumbers` e no `WhatsAppNumberListItem`.
- UI: quando aplicar um modelo, setar `businessTemplateId = tpl.id` no form; mostrar "Baseado em: {label}" no topo do modal.
- `prisma generate` + `db push` (dev). Teste em `numbers.service.test.ts`.
Commit: `feat(modelos): persiste businessTemplateId no número`

### Task 9.2: Botão "criar ofertas sugeridas"
**Files:** `src/components/WhatsAppNumbersPanel.tsx` (dentro do bloco de vendas, junto do `OffersManager`), reusando o `POST /api/numbers/[id]/offers` existente.
- Quando `salesEnabled` && o modelo tiver `suggestedOffers`, mostrar botão que faz POST de cada oferta com `priceCents = 0` (preço a definir) e `name/description` do modelo. Recarregar o `OffersManager`.
- Só faz sentido para modelos com `suggested.sales = true`; popular `suggestedOffers` nesses.
Commit: `feat(modelos): semear ofertas sugeridas do modelo`

---

## Fase 10 — Docs

### Task 10.1: Atualizar onboarding
**Files:** [`docs/onboarding-assistido.md`](../../docs/onboarding-assistido.md)
- No passo da IA/atendimento, mencionar: "escolha um **modelo de negócio** para pré-preencher a config e só ajustar os `[colchetes]`".
Commit: `docs(modelos): menciona modelos de negócio no onboarding`

---

## Apêndice A — Catálogo-alvo (~50 modelos)

| Categoria | Modelos (`id`) |
|---|---|
| **Saúde** | clinica-odontologica ✅, clinica-medica, clinica-estetica, fisioterapia, psicologia, nutricionista, clinica-veterinaria, laboratorio-exames |
| **Beleza** | salao-beleza, barbearia, studio-sobrancelha-cilios, estudio-tatuagem, spa-massagem, manicure-nail-designer |
| **Automotivo** | oficina-mecanica ✅, funilaria-pintura, auto-eletrica, revenda-veiculos, estetica-automotiva-lavarapido, locadora-veiculos, borracharia |
| **Serviços residenciais** | dedetizadora, limpeza-diarista, eletricista, encanador, ar-condicionado, marido-de-aluguel, jardinagem-paisagismo, chaveiro |
| **Educação** | escola-idiomas, curso-profissionalizante, autoescola-cfc, escola-infantil, reforco-professor-particular |
| **Alimentação** | restaurante-delivery, pizzaria-hamburgueria, confeitaria-bolos, buffet-eventos |
| **Varejo** | loja-roupas-moda, otica, moveis-decoracao, materiais-construcao, petshop-produtos, distribuidora-atacado |
| **Serviços profissionais** | advocacia, contabilidade, corretor-imoveis, corretor-seguros, agencia-marketing, arquitetura-design-interiores |
| **Fitness** | academia, personal-trainer, pilates-yoga, crossfit, escola-natacao |
| **Eventos** | fotografia-filmagem, decoracao-festas, aluguel-equipamentos-festa, cerimonial-casamento |
| **Imóveis & Turismo** | imobiliaria, agencia-viagens |
| **Genérico** | atendimento-generico |

✅ = já implementado na Fase 1.

## Apêndice B — Ordem de execução & verificação

- **Fases 0→3** são o núcleo funcional (com só 2 modelos já dá pra demonstrar). Entregar/validar antes de encarar o volume.
- **Fases 5→8** são volume de conteúdo, paralelizáveis, baixo risco (só dados + teste de integridade).
- **Fase 9** é opcional e tem custo de migração — decidir depois.
- **Gate de cada commit:** `npx tsc --noEmit` + `npx vitest run src/lib/business-templates.test.ts`. Antes de fechar: `npm test` + `npm run lint`.
