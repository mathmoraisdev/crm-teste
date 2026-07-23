# Onboarding "Primeiros passos" in-app — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` para implementar task-a-task.

> **Status: CONGELADO p/ implementação (2026-06-27).** Todas as suposições foram verificadas contra o código: `Meeting` é 1:1 com `Lead` via `leadId` (sem `userId` direto → query por `lead.userId`); rotas reais confirmadas no `Sidebar` — conectar chip = **`/empresas`**, IA = **`/configuracoes`**, agenda = **`/agenda`**; UI da IA confirmada em `src/app/(app)/configuracoes/page.tsx`; convenção de teste = `vi.mock("@/server/db/client")`. Não há mais `href` a "confirmar na execução".

**Goal:** Evoluir o checklist "Primeiros passos" que já existe na dashboard (`/leads`) de **3 itens hardcoded** para um checklist **dinâmico e ciente do plano**, com cada item marcado automaticamente a partir do banco. Itens de feature gateada (qualificação por IA, agenda) só aparecem para quem tem o plano que as inclui — senão o contador "X de N" fica mentiroso e o cliente vê passo que não consegue concluir.

**Contexto (o que já existe):**
- Service: [src/server/services/onboarding.service.ts](../../src/server/services/onboarding.service.ts) — `getOnboardingState(userId)` conta `whatsAppNumber`, `lead`, `campaign`. Retorna `{ hasNumber, hasLeads, hasCampaign, done }`.
- Componente: [src/components/OnboardingChecklist.tsx](../../src/components/OnboardingChecklist.tsx) — client component, 3 steps hardcoded, some quando `state.done`. Contador "X de 3" fixo.
- Render: [src/app/(app)/leads/page.tsx](<../../src/app/(app)/leads/page.tsx>) — server component, chama `getOnboardingState(userId)` com `getTenantUserId()` e renderiza `<OnboardingChecklist>` acima do `<LeadsDashboard>`.
- Plano/entitlements: [src/lib/plans.ts](../../src/lib/plans.ts) — `PLAN_LIMITS[plan]` com flags `qualify`, `schedule`, `campaigns`. INICIAL não tem nenhuma das três; PROFISSIONAL/ESCALA têm todas.
- Status IA: [src/server/services/ai-credential.service.ts](../../src/server/services/ai-credential.service.ts) — `getAiCredentialStatus(userId)` → `{ configured, ... }` (`configured = !!user.aiProvider`).
- Agenda: model `Meeting` (relação `lead.userId`), status `PROPOSED|CONFIRMED|CANCELLED`.

**Tech Stack:** Next.js (App Router, server components), Prisma + PostgreSQL, Tailwind, TypeScript. Sem mudança de schema.

**Decisões travadas (não relitigar):**
- **Sem schema novo.** Tudo derivado de contagens/flags que já existem.
- **Checklist é ciente do plano.** O conjunto de passos depende de `PLAN_LIMITS[plan]`. Plano `null` (contas legadas/admin) → mostra o conjunto base (número + leads) sem travar nada.
- **`done` = todos os passos *aplicáveis* concluídos.** Some o card inteiro quando completo, igual hoje.
- **Itens auto-marcados.** Nada de marcar manualmente — o estado vem do banco a cada render do server component. Sem persistir "dismissed" nesta versão (decisão consciente; ver "Fora de escopo").
- **Contador dinâmico:** "X de N", onde N = nº de passos aplicáveis ao plano (não fixo em 3).
- O passo "Campanha" só aparece se `PLAN_LIMITS.campaigns` (INICIAL não cria campanha).

**Mapa de passos por plano:**

| Passo | Sinal (banco) | INICIAL | PROFISSIONAL | ESCALA | plano `null` |
|---|---|---|---|---|---|
| Conectar número | `whatsAppNumber.count > 0` | ✅ | ✅ | ✅ | ✅ |
| Importar leads | `lead.count > 0` | ✅ | ✅ | ✅ | ✅ |
| Configurar IA | `aiProvider != null` | — | ✅ | ✅ | — |
| Criar campanha | `campaign.count > 0` | — | ✅ | ✅ | ✅ |
| 1º agendamento | `meeting.count > 0` | — | ✅ | ✅ | — |

> "✅" = passo aparece no checklist daquele plano. "—" = omitido (feature não contratada). Plano `null` mostra o subconjunto seguro (número + leads + campanha) sem features gateadas.

---

## Fase 1 — Service ciente do plano

### Task 1.1: Expandir `getOnboardingState`

**Files:**
- Modify: [src/server/services/onboarding.service.ts](../../src/server/services/onboarding.service.ts)

**Step 1: Nova forma do estado.** Trocar a interface por uma lista de passos + meta, em vez de booleans soltos. Cada passo já carrega se aplica ao plano e se está feito:

```ts
import { prisma } from "@/server/db/client";
import { PLAN_LIMITS } from "@/lib/plans";
// Nota: NÃO importar `Plan` do @prisma/client aqui — `PLAN_LIMITS` já é
// `Record<Plan, ...>` e o narrowing `plan ? PLAN_LIMITS[plan] : null` basta.
// Import não usado quebraria o lint/tsc (objetivo: zero erro).

export type OnboardingStepKey =
  | "number" | "leads" | "ai" | "campaign" | "meeting";

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[]; // só os passos aplicáveis ao plano
  completed: number;       // quantos done
  total: number;           // steps.length
  done: boolean;           // completed === total → esconde o card
}
```

**Step 2: Implementação.** Busca o plano do dono (o `userId` recebido já é o `tenantUserId`/dono — ver nota de tenancy abaixo) e monta a lista só com os passos aplicáveis:

```ts
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [user, numbers, leads, campaigns, meetings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true, aiProvider: true } }),
    prisma.whatsAppNumber.count({ where: { userId } }),
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.meeting.count({ where: { lead: { userId } } }),
  ]);

  const plan = user?.plan ?? null;
  const limits = plan ? PLAN_LIMITS[plan] : null;

  // Plano null (legado/admin) libera o subconjunto seguro; com plano, respeita o gating.
  const showAi = limits?.qualify ?? false;
  const showCampaign = limits?.campaigns ?? true;
  const showMeeting = limits?.schedule ?? false;

  const all: Array<OnboardingStep & { show: boolean }> = [
    { key: "number",   done: numbers > 0,        show: true },
    { key: "leads",    done: leads > 0,          show: true },
    { key: "ai",       done: !!user?.aiProvider, show: showAi },
    { key: "campaign", done: campaigns > 0,      show: showCampaign },
    { key: "meeting",  done: meetings > 0,       show: showMeeting },
  ];

  const steps = all.filter((s) => s.show).map(({ key, done }) => ({ key, done }));
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, done: completed === steps.length };
}
```

**Nota de tenancy:** o `page.tsx` já passa `getTenantUserId()` (= `ownerId ?? id`, o dono). Como `plan`/`aiProvider` vivem no dono e todos os counts escopam por `userId` do dono, a query está correta sem mudança no caller. Confirmar que `prisma.meeting` filtra por `{ lead: { userId } }` (Meeting não tem `userId` direto — pendura no Lead).

**Step 3: Verificar build de tipos.**

Run: `npx tsc --noEmit`
Expected: sem erros. (A mudança de interface vai quebrar o componente — corrigido na Task 2.1; rode o tsc de novo ao final da Fase 2.)

---

## Fase 2 — Componente dinâmico

### Task 2.1: Render a partir de `steps`

**Files:**
- Modify: [src/components/OnboardingChecklist.tsx](../../src/components/OnboardingChecklist.tsx)

**Step 1: Catálogo de apresentação por `key`.** Mover título/descrição/ícone/CTA para um mapa estático indexado por `OnboardingStepKey` (a ordem de render segue a ordem de `state.steps`, que já vem do service):

```ts
import { Check, MessageSquare, Upload, Megaphone, Bot, CalendarClock, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { OnboardingStepKey } from "@/server/services/onboarding.service";

const STEP_META: Record<OnboardingStepKey, {
  icon: LucideIcon; title: string; description: string; href: string; cta: string;
}> = {
  number:   { icon: MessageSquare, title: "Conecte um número de WhatsApp",
              description: "Pareie um chip para começar a enviar e receber mensagens.",
              href: "/empresas", cta: "Conectar número" },
  leads:    { icon: Upload, title: "Importe seus leads",
              description: "Suba um CSV de contatos pelo botão “Importar CSV” aqui em cima.",
              href: "/leads", cta: "Importar CSV" },
  ai:       { icon: Bot, title: "Configure a IA de atendimento",
              description: "Conecte sua chave para a IA qualificar leads automaticamente.",
              href: "/configuracoes", cta: "Configurar IA" },
  campaign: { icon: Megaphone, title: "Crie e dispare uma campanha",
              description: "Monte a mensagem com {{nome}} e comece a falar com o funil.",
              href: "/campaigns", cta: "Criar campanha" },
  meeting:  { icon: CalendarClock, title: "Agende sua primeira reunião",
              description: "Marque um agendamento na Agenda — o lead recebe lembrete no WhatsApp.",
              href: "/agenda", cta: "Abrir agenda" },
};
```

> **Rotas verificadas** contra o `Sidebar` e as páginas: número → `/empresas` (corrige o `href` errado de hoje, que aponta p/ `/campaigns`), IA → `/configuracoes`, agenda → `/agenda`, campanha → `/campaigns`, leads → `/leads`. Nada a confirmar.

**Step 2: Render dirigido por `state.steps`.** Trocar o array hardcoded por `state.steps.map(...)`, puxando a apresentação de `STEP_META[step.key]`. Contador passa a usar `state.completed` / `state.total`:

```tsx
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  if (state.done) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink">Primeiros passos</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Configure sua conta para começar a vender no WhatsApp.
          </p>
        </div>
        <span className="text-xs font-bold text-slate-500">
          {state.completed} de {state.total}
        </span>
      </div>
      <ol className="divide-y divide-slate-100">
        {state.steps.map((step) => {
          const meta = STEP_META[step.key];
          const Icon = meta.icon;
          return ( /* mesma <li> de hoje: ícone+check, título line-through quando done, CTA quando !done */ );
        })}
      </ol>
    </Card>
  );
}
```

Manter exatamente o mesmo markup/estilo da `<li>` atual (bolinha `bg-brand-500`/`bg-[#EBF0ED]`, título `line-through` quando done, CTA com `ArrowRight`). Só a fonte dos dados muda.

**Step 3: Tipagem.** Importar `OnboardingState` do service como hoje. Garantir que nenhuma referência a `state.hasNumber/hasLeads/hasCampaign` sobrou.

Run: `npx tsc --noEmit`
Expected: sem erros.

---

## Fase 3 — Verificação

### Task 3.1: Conferir o caller

**Files:**
- Read (provavelmente sem mudança): [src/app/(app)/leads/page.tsx](<../../src/app/(app)/leads/page.tsx>)

A assinatura `getOnboardingState(userId)` não muda, então o `page.tsx` continua igual e ainda compila (passa `state` direto pro componente; `!onboarding.done` segue válido). **Único ajuste cosmético:** o comentário nas linhas 7-8 cita só "número + leads + campanha" — atualizar para refletir que os passos agora dependem do plano (IA/agenda em Profissional/Escala). Não muda comportamento.

### Task 3.2: Verificação manual

Run: `npm run dev`

Cenários:
- [ ] **Conta nova PROFISSIONAL/ESCALA, zerada:** card mostra 5 passos (número, leads, IA, campanha, agenda), "0 de 5", todos com CTA.
- [ ] **Conta INICIAL:** INICIAL tem `campaigns/qualify/schedule = false` → sobram só número + leads → **"0 de 2"**. Comportamento **intencional** (Inicial não cria campanha/IA/agenda; mostrar passo que ele não pode concluir seria pior). Não é bug.
- [ ] Conectar 1 número → passo "Conectar número" vira check verde, contador sobe.
- [ ] Importar 1 lead → check.
- [ ] Salvar chave de IA (plano com `qualify`) → passo IA vira check.
- [ ] Completar todos os passos aplicáveis → **card some** (`state.done`).
- [ ] **Conta `plan = null` (admin/legado):** mostra número + leads + campanha, sem IA/agenda; não trava.

### Task 3.3: Teste unitário do service (opcional, recomendado)

**Files:**
- Create: `src/server/services/onboarding.service.test.ts`

Seguir a convenção do projeto (igual a [entitlements.test.ts](../../src/server/services/entitlements.test.ts)): `vi.mock("@/server/db/client")` com `vi.fn()` por método, `import()` dinâmico do service **depois** do mock, e `(prisma.X.Y as any).mockResolvedValue(...)` por caso. Métodos a mockar: `user.findUnique`, `whatsAppNumber.count`, `lead.count`, `campaign.count`, `meeting.count`.

```ts
vi.mock("@/server/db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    whatsAppNumber: { count: vi.fn() },
    lead: { count: vi.fn() },
    campaign: { count: vi.fn() },
    meeting: { count: vi.fn() },
  },
}));
```

Cobrir:
- INICIAL omite IA, campanha e agenda → **total = 2** (número + leads).
- ESCALA inclui os 5 → total = 5.
- `plan = null` → número + leads + campanha → total = 3, sem IA/agenda.
- `done = true` só quando `completed === total` (ex.: todos os counts > 0 e `aiProvider` setado).

Run: `npx vitest run src/server/services/onboarding.service.test.ts`

### Task 3.4: Commit

```bash
git add src/server/services/onboarding.service.ts src/components/OnboardingChecklist.tsx
git commit -m "feat(onboarding): checklist de primeiros passos ciente do plano (IA + agenda)"
```

---

## Fora de escopo (decisões conscientes)

- **Dismiss manual / "não mostrar de novo":** hoje o card some sozinho quando tudo está feito. Persistir um "dispensado" exigiria campo no schema — adiado.
- **Barra de progresso percentual / animação:** o contador "X de N" basta nesta versão.
- **Espelhar o checklist na visão do operador vs dono:** o estado já escopa no dono (`tenantUserId`), então operador e dono veem o mesmo progresso — comportamento aceito.
- **Passo de "convidar operador" (seats):** poderia entrar, mas é gestão de equipe, não ativação de produto. Avaliar depois.

## Checklist de aceite

- [ ] `getOnboardingState` retorna passos filtrados por `PLAN_LIMITS` do plano do dono.
- [ ] Componente renderiza a partir de `state.steps`, contador "X de N" dinâmico.
- [ ] IA e agenda aparecem só em planos com `qualify`/`schedule`.
- [ ] Card some quando todos os passos aplicáveis estão concluídos.
- [ ] `npx tsc --noEmit` limpo; `npm run dev` valida os cenários da Task 3.2.
