import type { LeadStatus } from "@prisma/client";
import type { Tone } from "@/components/ui/Badge";

/** Metadados de apresentação de cada status do pipeline. */
export const LEAD_STATUS_META: Record<
  LeadStatus,
  { label: string; tone: Tone; order: number }
> = {
  NOVO: { label: "Novo", tone: "blue", order: 0 },
  CONTATADO: { label: "Contatado", tone: "amber", order: 1 },
  EM_CONVERSA: { label: "Em conversa", tone: "violet", order: 2 },
  QUALIFICADO: { label: "Qualificado", tone: "green", order: 3 },
  REUNIAO_AGENDADA: { label: "Reunião agendada", tone: "emerald", order: 4 },
  OFERTA_ENVIADA: { label: "Oferta enviada", tone: "amber", order: 5 },
  PAGO: { label: "Pago", tone: "green", order: 6 },
  DESCARTADO: { label: "Descartado", tone: "red", order: 7 },
};

export type PipelineLabels = Partial<Record<LeadStatus, string>>;

/**
 * Mescla rótulos renomeados por conta sobre os defaults (só o `label`; tom/ordem
 * permanecem). `labels` aceita o Json bruto do `User.pipelineLabels`.
 */
export function resolveStatusMeta(
  labels?: PipelineLabels | null,
): typeof LEAD_STATUS_META {
  if (!labels) return LEAD_STATUS_META;
  const out = {} as typeof LEAD_STATUS_META;
  for (const status of Object.keys(LEAD_STATUS_META) as LeadStatus[]) {
    const override = labels[status];
    out[status] = {
      ...LEAD_STATUS_META[status],
      label:
        typeof override === "string" && override.trim()
          ? override.trim()
          : LEAD_STATUS_META[status].label,
    };
  }
  return out;
}

/** Ordem das colunas do kanban. */
export const PIPELINE_ORDER: LeadStatus[] = [
  "NOVO",
  "CONTATADO",
  "EM_CONVERSA",
  "QUALIFICADO",
  "REUNIAO_AGENDADA",
  "OFERTA_ENVIADA",
  "PAGO",
  "DESCARTADO",
];

/** Tom do score: <40 vermelho, 40–69 âmbar, ≥70 verde. */
export function scoreTone(score: number): Tone {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "slate";
}
