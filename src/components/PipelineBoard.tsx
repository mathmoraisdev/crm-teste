"use client";

import Link from "next/link";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LEAD_STATUS_META, PIPELINE_ORDER } from "@/lib/leadStatus";
import { formatPhone } from "@/lib/phone";
import type { LeadListItem } from "@/server/services/lead.service";

/** Kanban de leitura: uma coluna por status do pipeline. */
export function PipelineBoard({ leads }: { leads: LeadListItem[] }) {
  const byStatus = PIPELINE_ORDER.map((status) => ({
    status,
    meta: LEAD_STATUS_META[status],
    leads: leads.filter((l) => l.status === status),
  }));

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {byStatus.map((col) => (
        <div key={col.status} className="w-64 flex-shrink-0">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {col.meta.label}
            </span>
            <span className="rounded-full bg-slate-200 px-2 text-xs font-medium text-slate-600">
              {col.leads.length}
            </span>
          </div>
          <div className="space-y-2">
            {col.leads.map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-300 hover:shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {l.name}
                  </span>
                  <ScoreBadge score={l.score} />
                </div>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {formatPhone(l.phone)}
                </span>
                {l.lastMessage && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
                    {l.lastMessage}
                  </p>
                )}
              </Link>
            ))}
            {col.leads.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-300">
                vazio
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
