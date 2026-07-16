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
  setRamo: boolean;
  applyTheme: boolean;
  themePresetId: string | null;
  seedFields: boolean;
  seedCatalog: boolean;
  setLabels: boolean;
  applyAttendance: boolean;
  seedOffers: boolean;
}

/** PURA: dado o template + estado da conta + alvos, decide o que aplicar. */
export function planVertical(
  tpl: BusinessTemplate,
  ctx: { hasCatalogItems: boolean; allow: TemplateAllow; numberId: string | null; applyTheme: boolean },
): VerticalPlan {
  const preset = presetForCategory(tpl.category);
  // Só há tema dedicado quando o preset resolvido é da MESMA categoria (senão caiu no verde-padrão).
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
  const plan = planVertical(tpl, {
    hasCatalogItems: hasItems,
    allow,
    numberId: input.numberId,
    applyTheme: input.applyTheme,
  });
  const result: VerticalResult = { plan, errors: [] };

  // Ramo (fonte de verdade p/ os seeds subsequentes) — primeiro e obrigatório.
  await setBusinessTemplateId(userId, tpl.id);

  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  };

  if (plan.applyTheme && plan.themePresetId)
    await step("tema", async () => {
      await setBrandingPreset(userId, plan.themePresetId!);
    });
  if (plan.seedFields)
    await step("campos", async () => {
      result.fields = await seedCustomFieldPreset(userId, tpl.id);
    });
  if (plan.seedCatalog)
    await step("catálogo", async () => {
      result.catalogSeeded = (await seedCatalogFromTemplate(userId, tpl.id)).length;
    });
  if (plan.setLabels)
    await step("funil", async () => {
      await setPipelineLabels(userId, tpl.pipelineLabels as Record<string, unknown>);
    });
  if (plan.applyAttendance && input.numberId)
    await step("atendimento", async () => {
      const merged = applyTemplate(
        {
          persona: "",
          businessHours: "",
          knowledgeBase: "",
          customInstructions: "",
          autoReplyEnabled: false,
          qualifyEnabled: false,
          scheduleEnabled: false,
          salesEnabled: false,
        },
        tpl,
        { overwriteText: input.overwriteText, allow },
      );
      // updateWhatsAppNumber já re-gateia qualify/schedule/sales ao ligar.
      await updateWhatsAppNumber(input.numberId!, userId, {
        persona: merged.persona,
        knowledgeBase: merged.knowledgeBase,
        businessHours: merged.businessHours,
        customInstructions: merged.customInstructions,
        autoReplyEnabled: merged.autoReplyEnabled,
        qualifyEnabled: merged.qualifyEnabled,
        scheduleEnabled: merged.scheduleEnabled,
        salesEnabled: merged.salesEnabled,
      });
    });
  if (plan.seedOffers && input.numberId)
    await step("ofertas", async () => {
      result.offers = await seedOffersFromTemplate(userId, input.numberId!, tpl.id);
    });

  return result;
}
