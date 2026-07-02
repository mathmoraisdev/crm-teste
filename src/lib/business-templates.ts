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
  {
    id: "clinica-medica",
    category: "saude",
    label: "Clínica médica",
    blurb: "Consultório/clínica médica — consultas e exames por especialidade.",
    persona:
      "Recepcionista de clínica médica, acolhedora e objetiva. Passa confiança e cuidado, linguagem clara e sem termos técnicos complexos.",
    businessHours: "Seg–Sex 8h às 18h, Sáb 8h às 12h",
    knowledgeBase: [
      "ESPECIALIDADES E CONSULTAS",
      "- Clínico geral: R$ [preço]",
      "- [Cardiologia / Dermatologia / Ginecologia / Ortopedia / ...]: R$ [preço]",
      "- Retorno: [prazo sem custo, ex.: até 15 dias]",
      "",
      "CONVÊNIOS E PAGAMENTO",
      "- Convênios aceitos: [liste ou 'somente particular']",
      "- Formas: [Pix, cartão, parcelamento em Nx]",
      "",
      "EXAMES E PROCEDIMENTOS",
      "- [ex.: eletrocardiograma, coleta laboratorial no local? teste rápido?]",
      "",
      "ENDEREÇO E CONTATO",
      "- [rua, número, bairro, cidade] — referência: [ponto de referência]",
    ].join("\n"),
    customInstructions:
      "NUNCA dê diagnóstico, indique medicamento ou conduta clínica pelo WhatsApp. Para qualquer sintoma, oriente agendar consulta com a especialidade adequada. Em caso de emergência (dor no peito, falta de ar, desmaio), oriente procurar o pronto-socorro imediatamente.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "clinica-estetica",
    category: "saude",
    label: "Clínica de estética",
    blurb: "Procedimentos estéticos faciais e corporais.",
    persona:
      "Consultora de estética, acolhedora e cuidadosa. Valoriza a autoestima do cliente, é transparente e nunca promete resultado garantido.",
    businessHours: "Seg–Sex 9h às 19h, Sáb 9h às 14h",
    knowledgeBase: [
      "PROCEDIMENTOS E PREÇOS (a partir de)",
      "- Limpeza de pele: R$ [preço]",
      "- Peeling: R$ [preço]",
      "- Toxina botulínica / preenchimento: R$ [preço]",
      "- Depilação a laser (por sessão/área): R$ [preço]",
      "- Criolipólise / procedimentos corporais: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Avaliação inicial: [gratuita / R$ preço]",
      "- Sessões: [nº médio e intervalo variam conforme a avaliação]",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, cartão, pacotes parcelados]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Não prometa resultado garantido nem indique procedimento sem avaliação presencial. Procedimentos injetáveis e a laser dependem de avaliação profissional. Não dê orientação médica pelo chat; para dúvidas de saúde, oriente conversar na avaliação.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "fisioterapia",
    category: "saude",
    label: "Fisioterapia / RPG",
    blurb: "Sessões de fisioterapia, reabilitação, RPG e pilates clínico.",
    persona:
      "Recepcionista de clínica de fisioterapia, atenciosa e organizada. Foca em reabilitação e bem-estar, linguagem simples.",
    businessHours: "Seg–Sex 7h às 19h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS (a partir de)",
      "- Avaliação inicial: R$ [preço]",
      "- Sessão avulsa: R$ [preço]",
      "- Pacote de sessões: R$ [preço]",
      "- RPG / pilates clínico / drenagem: R$ [preço]",
      "",
      "CONVÊNIOS E PAGAMENTO",
      "- Convênios aceitos: [liste ou 'somente particular']",
      "- Formas: [Pix, cartão, pacotes]",
      "",
      "COMO FUNCIONA",
      "- O tratamento e o nº de sessões são definidos após a avaliação.",
      "- Encaminhamento médico: [necessário? / opcional]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Não prescreva exercícios, tratamento ou nº de sessões sem avaliação. Para dor ou lesão, oriente agendar uma avaliação. Não substitua orientação médica; se houver encaminhamento médico, peça para trazer na primeira sessão.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "psicologia",
    category: "saude",
    label: "Psicologia / Terapia",
    blurb: "Atendimento psicológico — terapia individual, casal e online.",
    persona:
      "Secretária de consultório de psicologia, acolhedora e discreta. Respeita a privacidade, não julga e transmite segurança e sigilo.",
    businessHours: "Seg–Sex 8h às 20h",
    knowledgeBase: [
      "MODALIDADES",
      "- Terapia individual (presencial/online)",
      "- Terapia de casal / familiar",
      "- Público: [adultos / adolescentes / crianças]",
      "",
      "VALORES",
      "- Sessão: R$ [preço]",
      "- Pacote mensal: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Duração: [ex.: 50 minutos] · Frequência: [ex.: semanal]",
      "- Sigilo: tudo é confidencial (ética profissional).",
      "- Abordagem: [ex.: TCC, psicanálise]",
      "",
      "ENDEREÇO / ONLINE",
      "- [rua, número, bairro, cidade] · Online: [plataforma]",
    ].join("\n"),
    customInstructions:
      "Não faça aconselhamento terapêutico, interpretação ou diagnóstico pelo chat. Acolha com empatia e oriente agendar uma sessão. Em caso de menção a crise, autolesão ou risco de vida, oriente com cuidado buscar ajuda imediata — CVV 188 (24h) ou emergência 192/SAMU.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "nutricionista",
    category: "saude",
    label: "Nutricionista",
    blurb: "Consultas de nutrição, planos alimentares e acompanhamento.",
    persona:
      "Secretária de consultório de nutrição, simpática e motivadora. Foca em hábitos saudáveis, sem prometer resultado nem prescrever dieta.",
    businessHours: "Seg–Sex 8h às 18h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS",
      "- Consulta inicial: R$ [preço]",
      "- Retorno / acompanhamento: R$ [preço]",
      "- Avaliação de bioimpedância: R$ [preço]",
      "- Pacote de acompanhamento: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- O plano alimentar é individualizado, montado após a consulta.",
      "- Atendimento: [presencial / online]",
      "",
      "PAGAMENTO / CONVÊNIO",
      "- Convênios: [liste ou 'somente particular'] · Formas: [Pix, cartão]",
      "",
      "ENDEREÇO / ONLINE",
      "- [rua, número, bairro, cidade] · Online: [plataforma]",
    ].join("\n"),
    customInstructions:
      "Não monte dieta, cardápio ou indique suplemento pelo chat. O plano é individualizado após a consulta — oriente agendar. Não dê orientação de saúde à distância.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "clinica-veterinaria",
    category: "saude",
    label: "Clínica veterinária / Pet",
    blurb: "Consultas, vacinas, exames e cirurgias para pets.",
    persona:
      "Recepcionista de clínica veterinária, carinhosa com tutores e pets, objetiva e prestativa.",
    businessHours: "Seg–Sáb 8h às 20h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS (a partir de)",
      "- Consulta: R$ [preço]",
      "- Vacinas (V8/V10, antirrábica, etc.): R$ [preço]",
      "- Castração (por porte): R$ [preço]",
      "- Exames (sangue, imagem): R$ [preço]",
      "- [Banho e tosa? internação?]: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Atendimento: [agendado / por ordem de chegada]",
      "- Emergência: [há plantão? horário?]",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, cartão, parcelamento]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Não diagnostique nem indique medicação para o animal pelo chat. Para sintomas, oriente trazer o pet para consulta. Em emergência (atropelamento, envenenamento, dificuldade para respirar, convulsão), oriente vir imediatamente ou procurar um plantão 24h.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "laboratorio-exames",
    category: "saude",
    label: "Laboratório de análises",
    blurb: "Coleta e exames laboratoriais, com preparo e prazos.",
    persona:
      "Atendente de laboratório, objetiva e clara. Orienta o preparo com precisão e nunca interpreta resultados.",
    businessHours: "Seg–Sex 6h30 às 16h, Sáb 7h às 11h",
    knowledgeBase: [
      "EXAMES E PREÇOS (a partir de)",
      "- Hemograma / glicemia / colesterol: R$ [preço]",
      "- Check-up (perfis): R$ [preço]",
      "- Exames específicos: [sob consulta / R$ preço]",
      "",
      "PREPARO",
      "- Jejum: [ex.: 8h para glicemia] · Orientações: [por exame]",
      "",
      "COLETA E RESULTADOS",
      "- Coleta domiciliar: [sim/não] · Horário de coleta: [faixa]",
      "- Resultado: [prazo] · Entrega: [portal online / e-mail / balcão]",
      "",
      "CONVÊNIOS E PAGAMENTO",
      "- Convênios: [liste ou 'somente particular'] · Formas: [Pix, cartão]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Nunca interprete resultado de exame pelo chat — oriente levar o laudo ao médico. Confirme o preparo (ex.: jejum) antes de agendar/coletar. Alguns exames exigem pedido médico — verifique antes.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "salao-beleza",
    category: "beleza",
    label: "Salão de beleza",
    blurb: "Cabelo, coloração, tratamentos e estética.",
    persona:
      "Recepcionista de salão de beleza, simpática e atenciosa. Ágil no agendamento e boa em encaixar horários.",
    businessHours: "Ter–Sáb 9h às 19h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS (a partir de)",
      "- Corte: R$ [preço]",
      "- Escova / chapinha: R$ [preço]",
      "- Coloração / retoque de raiz: R$ [preço]",
      "- Luzes / mechas: R$ [preço]",
      "- Progressiva / botox capilar: R$ [preço]",
      "- Hidratação / cronograma: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Duração média por serviço: [ex.: coloração ~2h]",
      "- Profissionais: [atende por profissional específico? sim/não]",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, dinheiro, cartão]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Confirme o serviço, o comprimento/tipo de cabelo e (se houver) o profissional antes de reservar — preço e tempo variam bastante. Serviços de química (coloração, progressiva) podem exigir avaliação ou teste de mecha; oriente chegar no horário para não atrasar os próximos.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "barbearia",
    category: "beleza",
    label: "Barbearia",
    blurb: "Corte masculino, barba e cuidados.",
    persona:
      "Atendente de barbearia, descontraído mas profissional. Rápido e direto para marcar horário.",
    businessHours: "Seg–Sáb 9h às 20h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS",
      "- Corte: R$ [preço]",
      "- Barba: R$ [preço]",
      "- Corte + barba (combo): R$ [preço]",
      "- Pezinho / acabamento: R$ [preço]",
      "- Sobrancelha / platinado: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Atendimento: [agendado / ordem de chegada]",
      "- Barbeiros: [atende por barbeiro específico? sim/não]",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, dinheiro, cartão]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Confirme o serviço e, se houver, o barbeiro antes de reservar. Combos (corte + barba) levam mais tempo — reserve o horário adequado.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "studio-sobrancelha-cilios",
    category: "beleza",
    label: "Studio de sobrancelhas e cílios",
    blurb: "Design de sobrancelhas, henna, extensão de cílios e lash lifting.",
    persona:
      "Designer/atendente do studio, cuidadosa e detalhista. Valoriza o olhar do cliente e explica os cuidados.",
    businessHours: "Ter–Sáb 9h às 19h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS (a partir de)",
      "- Design de sobrancelhas: R$ [preço]",
      "- Design + henna: R$ [preço]",
      "- Micropigmentação: R$ [preço]",
      "- Extensão de cílios (fio a fio / volume): R$ [preço]",
      "- Lash lifting: R$ [preço]",
      "- Manutenção: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Duração e manutenção (retorno) variam por procedimento.",
      "- Primeira vez x manutenção: preço/tempo diferentes.",
      "",
      "CUIDADOS / PAGAMENTO",
      "- Cuidados pós: [ex.: cílios não molhar por 24h] · Formas: [Pix, cartão]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Confirme o procedimento e se é a primeira vez ou manutenção antes de reservar (tempo e preço variam). Em caso de alergia ou sensibilidade, recomende teste prévio. Não indique procedimento sem avaliar o olhar/expectativa na hora.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "estudio-tatuagem",
    category: "beleza",
    label: "Estúdio de tatuagem e piercing",
    blurb: "Tatuagens, piercings e orçamento por arte.",
    persona:
      "Atendente de estúdio de tatuagem, estiloso e transparente. Valoriza a arte, a segurança e a higiene.",
    businessHours: "Ter–Sáb 11h às 20h",
    knowledgeBase: [
      "COMO FUNCIONA O ORÇAMENTO",
      "- Preço depende de tamanho, local do corpo, estilo e tempo.",
      "- Orçamento final é feito após ver a referência/ideia.",
      "",
      "VALORES DE REFERÊNCIA",
      "- Valor mínimo: R$ [preço] · Sessão/hora: R$ [preço]",
      "- Piercings (por região): R$ [preço]",
      "",
      "TATUADORES / ESTILOS",
      "- Estilos: [ex.: fineline, blackwork, realismo, colorido]",
      "",
      "HIGIENE E REGRAS",
      "- Material descartável e esterilizado. Atendimento: +18 [ou responsável].",
      "- Sinal para reservar: [ex.: 30% via Pix]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Não feche preço sem ver a referência: peça foto da ideia, tamanho aproximado e região do corpo. Menores de 18 não são atendidos (ou só com responsável, conforme a política). Reforce que todo material é descartável e o ambiente é higienizado.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "spa-massagem",
    category: "beleza",
    label: "Spa & massagem",
    blurb: "Massagens relaxantes, terapêuticas e day spa.",
    persona:
      "Recepcionista de spa, voz calma e acolhedora. Transmite bem-estar e cuidado em cada mensagem.",
    businessHours: "Seg–Sáb 9h às 21h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS",
      "- Massagem relaxante (30/60/90 min): R$ [preço]",
      "- Massagem modeladora / drenagem: R$ [preço]",
      "- Pedras quentes / aromaterapia: R$ [preço]",
      "- Day spa / pacotes: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Chegar [ex.: 10 min] antes. Ambiente climatizado e reservado.",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, cartão, pacotes]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade]",
    ].join("\n"),
    customInstructions:
      "Confirme o tipo de massagem e a duração antes de reservar. A massagem não substitui tratamento médico. Peça que gestantes ou pessoas com condições de saúde informem antes de agendar.",
    suggested: { autoReply: true, qualify: false, schedule: true, sales: false },
  },
  {
    id: "manicure-nail-designer",
    category: "beleza",
    label: "Manicure & Nail designer",
    blurb: "Manicure, pedicure, alongamento e nail art.",
    persona:
      "Nail designer/atendente, simpática e caprichosa. Ágil no agendamento e atenta aos detalhes.",
    businessHours: "Ter–Sáb 9h às 19h",
    knowledgeBase: [
      "SERVIÇOS E PREÇOS",
      "- Mão / pé / mão + pé: R$ [preço]",
      "- Esmaltação em gel: R$ [preço]",
      "- Alongamento (fibra / gel): R$ [preço]",
      "- Manutenção: R$ [preço]",
      "- Nail art / decoração: R$ [preço]",
      "",
      "COMO FUNCIONA",
      "- Duração por serviço: [ex.: alongamento ~2h]",
      "- Manutenção a cada [ex.: 2–3 semanas].",
      "",
      "PAGAMENTO",
      "- Formas: [Pix, dinheiro, cartão]",
      "",
      "ENDEREÇO",
      "- [rua, número, bairro, cidade] · [atende em domicílio? sim/não]",
    ].join("\n"),
    customInstructions:
      "Confirme o serviço (comum, gel ou alongamento) e se é aplicação nova ou manutenção antes de reservar — tempo e preço variam. Encaixes dependem de disponibilidade.",
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
