"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { formatSlot } from "@/lib/utils";
import type { LeadDetail } from "@/server/services/lead.service";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";
import {
  CalendarCheck,
  CalendarClock,
  Sparkles,
  Target,
  Building2,
  UserCheck,
  Gauge,
  Wallet,
  ListChecks,
  MessageSquareQuote,
} from "lucide-react";

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </p>
        <p className="text-sm text-slate-700">
          {value ?? <span className="text-slate-300">—</span>}
        </p>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  ask_question: "Continuar conversa",
  schedule_meeting: "Agendar reunião",
  discard: "Descartar",
};

function formatCfValue(type: CustomFieldDefItem["type"], value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "BOOLEAN":
      return value ? "Sim" : "Não";
    case "DATE": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("pt-BR");
    }
    default:
      return String(value);
  }
}

function CustomFieldsCard({ customFields }: { customFields: unknown }) {
  const [defs, setDefs] = useState<CustomFieldDefItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/custom-fields", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) setDefs((d.defs as CustomFieldDefItem[]) ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (defs.length === 0) return null;
  const values =
    customFields && typeof customFields === "object" && !Array.isArray(customFields)
      ? (customFields as Record<string, unknown>)
      : {};

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <ListChecks size={15} className="text-slate-500" /> Campos customizados
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-x-4 px-4 py-2 sm:grid-cols-2">
        {defs.map((d) => (
          <Field
            key={d.id}
            icon={<ListChecks size={14} />}
            label={d.label}
            value={formatCfValue(d.type, values[d.key])}
          />
        ))}
      </div>
    </Card>
  );
}

export function QualificationPanel({
  qualification,
  meeting,
  customFields,
}: {
  qualification: LeadDetail["qualification"];
  meeting: LeadDetail["meeting"];
  customFields?: unknown;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles size={15} className="text-brand-500" /> Qualificação (IA)
            </span>
          }
          action={
            qualification ? <ScoreBadge score={qualification.score} /> : null
          }
        />
        <div className="px-4 py-2">
          {!qualification ? (
            <p className="py-4 text-center text-sm text-slate-400">
              Ainda sem qualificação. Ela é gerada quando o lead responde.
            </p>
          ) : (
            <>
              {qualification.summary && (
                <p className="mb-2 rounded-md bg-slate-50 p-2.5 text-sm text-slate-600">
                  {qualification.summary}
                </p>
              )}
              {"scoreJustification" in qualification && qualification.scoreJustification && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-100 bg-amber-50 p-2.5">
                  <MessageSquareQuote size={15} className="mt-0.5 shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-800">
                    {qualification.scoreJustification as string}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Field
                  icon={<Target size={14} />}
                  label="Interesse"
                  value={qualification.interestLevel}
                />
                <Field
                  icon={<Gauge size={14} />}
                  label="Urgência"
                  value={qualification.urgency}
                />
                <Field
                  icon={<Building2 size={14} />}
                  label="Segmento"
                  value={qualification.segment}
                />
                <Field
                  icon={<Wallet size={14} />}
                  label="Orçamento"
                  value={qualification.budget}
                />
                <Field
                  icon={<Target size={14} />}
                  label="Dor"
                  value={qualification.painPoint}
                />
                <Field
                  icon={<UserCheck size={14} />}
                  label="Decisor?"
                  value={
                    qualification.isDecisionMaker === null
                      ? null
                      : qualification.isDecisionMaker
                        ? "Sim"
                        : "Não"
                  }
                />
              </div>
              {qualification.nextAction && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <span className="text-xs text-slate-400">Próxima ação: </span>
                  <Badge tone="blue">
                    {ACTION_LABEL[qualification.nextAction] ??
                      qualification.nextAction}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <CustomFieldsCard customFields={customFields} />

      {meeting && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <CalendarCheck size={15} className="text-emerald-500" /> Reunião
              </span>
            }
            action={
              <Badge
                tone={
                  meeting.status === "CONFIRMED"
                    ? "emerald"
                    : meeting.status === "CANCELLED"
                      ? "red"
                      : "amber"
                }
              >
                {meeting.status === "CONFIRMED"
                  ? "Confirmada"
                  : meeting.status === "CANCELLED"
                    ? "Cancelada"
                    : "Proposta"}
              </Badge>
            }
          />
          <div className="px-4 py-3 text-sm">
            {meeting.scheduledAt ? (
              <Field
                icon={<CalendarCheck size={14} />}
                label="Agendada para"
                value={formatSlot(new Date(meeting.scheduledAt).toISOString())}
              />
            ) : (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <CalendarClock size={14} /> Horários propostos
                </p>
                <ul className="space-y-1">
                  {(meeting.proposedSlots as string[]).map((s) => (
                    <li key={s} className="text-slate-600">
                      • {formatSlot(s)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {meeting.meetingLink && (
              <a
                href={meeting.meetingLink}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                Link da reunião →
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
