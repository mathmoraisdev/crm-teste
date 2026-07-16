import { prisma } from "@/server/db/client";
import { PLAN_LIMITS } from "@/lib/plans";
import { getTemplate } from "@/lib/business-templates";
import { moduleVisibleFor } from "@/lib/nav";
import type { BusinessCategory } from "@/lib/business-templates";
// Nota: NÃO importar `Plan` do @prisma/client aqui — `PLAN_LIMITS` já é
// `Record<Plan, ...>` e o narrowing `plan ? PLAN_LIMITS[plan] : null` basta.

export type OnboardingStepKey =
  | "ramo" | "number" | "ai" | "catalogo" | "estoque" | "agenda_setup"
  | "leads" | "campaign" | "meeting"
  | "menu_catalog" | "delivery_config" | "menu_publish";

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
  // Cardápio online / delivery: só ramos de alimentação (mesma regra da sidebar).
  const hasMenu = moduleVisibleFor(category, "producao");

  const catalogVariant: CatalogVariant =
    hasEstoque && hasAgenda ? "ambos" : hasEstoque ? "produtos" : "servicos";

  const steps: (PlannedStep & { show: boolean })[] = [
    { key: "ramo",         show: true },
    { key: "number",       show: true },
    { key: "ai",           show: qualify },
    { key: "catalogo",     show: true, variant: catalogVariant },
    { key: "estoque",      show: hasEstoque },
    { key: "menu_catalog", show: hasMenu },   // marque itens como visíveis no cardápio
    { key: "delivery_config", show: hasMenu }, // zonas + taxas + modalidades
    { key: "menu_publish", show: hasMenu },    // ligar menuEnabled + link público
    { key: "agenda_setup", show: hasAgenda },
    { key: "leads",        show: true },
    { key: "campaign",     show: campaigns },
    { key: "meeting",      show: hasAgenda },
  ];

  return steps.filter((s) => s.show).map(({ show: _show, ...s }) => s);
}

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  variant?: CatalogVariant; // só "catalogo" traz
}

export interface OnboardingState {
  steps: OnboardingStep[]; // só os passos aplicáveis ao plano
  completed: number;       // quantos done
  total: number;           // steps.length
  done: boolean;           // completed === total → esconde o card
}

/**
 * Estado do onboarding in-app, ciente do plano do dono da conta. O conjunto de
 * passos depende de `PLAN_LIMITS[plan]` e do ramo: a decisão de QUAIS passos
 * aparecem vive na função pura `planOnboardingSteps`; aqui só contamos os
 * registros reais e casamos cada passo com seu `done`. Plano `null`
 * (legado/admin) libera o subconjunto seguro sem travar nada. Tudo escopado
 * por `userId` (multitenant); o caller passa `getTenantUserId()` (= o dono),
 * onde `plan`/`aiProvider` vivem. `CatalogItem`/`Professional` são escopados
 * por `accountId` = esse mesmo `userId` (o tenant).
 */
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [user, numbers, leads, campaigns, meetings, catalogItems, stockItems, professionals, menuItems, deliveryZones] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, aiProvider: true, businessTemplateId: true, menuEnabled: true },
      }),
      prisma.whatsAppNumber.count({ where: { userId } }),
      prisma.lead.count({ where: { userId } }),
      prisma.campaign.count({ where: { userId } }),
      prisma.meeting.count({ where: { lead: { userId } } }),
      prisma.catalogItem.count({ where: { accountId: userId } }),
      prisma.catalogItem.count({ where: { accountId: userId, trackStock: true } }),
      prisma.professional.count({ where: { accountId: userId } }),
      // Cardápio online: itens marcados como visíveis no cardápio público.
      prisma.catalogItem.count({ where: { accountId: userId, menuVisible: true } }),
      // Delivery: zonas de bairro/taxa criadas.
      prisma.deliveryZone.count({ where: { accountId: userId } }),
    ]);

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
    menu_catalog:     menuItems > 0,
    delivery_config:  deliveryZones > 0,
    menu_publish:     !!user?.menuEnabled,
  };

  const steps: OnboardingStep[] = planned.map((s) => ({
    key: s.key,
    done: DONE[s.key],
    variant: s.variant, // carrega a variante do catálogo até a UI
  }));
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, done: completed === steps.length };
}
