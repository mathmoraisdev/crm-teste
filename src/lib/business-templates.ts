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
