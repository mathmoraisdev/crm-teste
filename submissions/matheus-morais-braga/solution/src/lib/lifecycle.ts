// src/lib/lifecycle.ts — decisões PURAS + textos das automações de ciclo de vida.
// Espelha a disciplina de dueReminder: decisão de janela given timestamps, sem DB.

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** PURA: um evento (comanda fechada, etc.) com marcador NULO está devido AGORA?
 *  Devido = passou o atraso (now - eventAt >= delayMs) E não é backlog antigo
 *  (now - eventAt <= floorMs) E ainda não foi enviado (marker == null) E o evento
 *  não está no futuro. O gate ligado/desligado (delay 0) é do service, não daqui. */
export function isDueAfter(input: {
  eventAt: Date;
  now: Date;
  delayMs: number;
  floorMs: number;
  marker: Date | null;
}): boolean {
  if (input.marker) return false;
  const age = input.now.getTime() - input.eventAt.getTime();
  if (age < input.delayMs) return false; // ainda não passou o atraso (cobre futuro: age<0)
  if (age > input.floorMs) return false; // antigo demais → não tocar o passado ao ligar
  return true;
}

/** PURA: renderiza {{nome}} (primeiro nome). Base p/ futuros placeholders. */
export function renderLifecycleTemplate(template: string, vars: { nome: string }): string {
  return template.replace(/\{\{\s*nome\s*\}\}/gi, vars.nome).trim();
}

// Textos padrão (v1 sem override por conta). Neutros de gênero/ramo.
export const DEFAULT_POSTSALE =
  "Oi, {{nome}}! Obrigado pela preferência 🙌 Foi um prazer te atender. Qualquer coisa, é só chamar!";
export const DEFAULT_REVIEW =
  "Oi, {{nome}}! Como foi sua experiência com a gente? De 0 a 10, o quanto você nos recomendaria? Sua resposta ajuda demais 🙏";
export const DEFAULT_REENGAGE =
  "Oi, {{nome}}! Faz um tempinho que a gente não se fala. Posso te ajudar em alguma coisa? 😊";

export const postSaleMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_POSTSALE, { nome: firstName(lead.name) });
export const reviewMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_REVIEW, { nome: firstName(lead.name) });
export const reengageMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_REENGAGE, { nome: firstName(lead.name) });
