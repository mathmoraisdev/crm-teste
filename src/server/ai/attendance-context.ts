/**
 * Monta (PURA) o bloco de contexto da empresa para o prompt de atendimento.
 * Omite seções ausentes para não poluir o prompt com "null".
 */
export function buildAttendanceContext(c: {
  displayName?: string | null;
  persona?: string | null;
  knowledgeBase?: string | null;
  businessHours?: string | null;
}): string {
  const parts: string[] = [];
  if (c.displayName) parts.push(`Empresa: ${c.displayName}`);
  if (c.persona) parts.push(`Persona/estilo: ${c.persona}`);
  if (c.businessHours) parts.push(`Horário de atendimento: ${c.businessHours}`);
  if (c.knowledgeBase) parts.push(`Base de conhecimento:\n${c.knowledgeBase}`);
  return parts.join("\n\n");
}
