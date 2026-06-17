import type { LeadStatus } from "@prisma/client";
import type { Tone } from "@/components/ui/Badge";

/** Metadados de apresentação de cada status do pipeline. */
export const LEAD_STATUS_META: Record<
  LeadStatus,
  { label: string; tone: Tone; order: number }
> = {
  NOVO: { label: "Novo", tone: "slate", order: 0 },
  CONTATADO: { label: "Contatado", tone: "blue", order: 1 },
  EM_CONVERSA: { label: "Em conversa", tone: "amber", order: 2 },
  QUALIFICADO: { label: "Qualificado", tone: "violet", order: 3 },
  REUNIAO_AGENDADA: { label: "Reunião agendada", tone: "emerald", order: 4 },
  DESCARTADO: { label: "Descartado", tone: "red", order: 5 },
};

/** Ordem das colunas do kanban. */
export const PIPELINE_ORDER: LeadStatus[] = [
  "NOVO",
  "CONTATADO",
  "EM_CONVERSA",
  "QUALIFICADO",
  "REUNIAO_AGENDADA",
  "DESCARTADO",
];

/** Tom do score: <40 vermelho, 40–69 âmbar, ≥70 verde. */
export function scoreTone(score: number): Tone {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "slate";
}
