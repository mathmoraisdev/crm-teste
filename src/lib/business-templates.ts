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
