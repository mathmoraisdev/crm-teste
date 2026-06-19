"use client";

import Link from "next/link";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LEAD_STATUS_META, PIPELINE_ORDER } from "@/lib/leadStatus";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

/** Coluna em verde-claro p/ os estágios "positivos" do funil. */
const POSITIVE = new Set(["QUALIFICADO", "REUNIAO_AGENDADA"]);

/** Kanban de leitura: uma coluna por status do pipeline. */
export function PipelineBoard({ leads }: { leads: LeadListItem[] }) {
  const byStatus = PIPELINE_ORDER.map((status) => ({
    status,
    meta: LEAD_STATUS_META[status],
    positive: POSITIVE.has(status),
    leads: leads.filter((l) => l.status === status),
  }));

  return (
    <div className="scroll-thin flex gap-4 overflow-x-auto pb-2">
      {byStatus.map((col) => (
        <div
          key={col.status}
          className={cn(
            "w-[272px] flex-shrink-0 rounded-2xl p-3.5",
            col.positive ? "bg-brand-50" : "bg-[#EFF3F1]",
          )}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <span
              className={cn(
                "text-[13px] font-bold",
                col.positive ? "text-brand-700" : "text-ink",
              )}
            >
              {col.meta.label}
            </span>
            <span
              className={cn(
                "rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold",
                col.positive ? "text-brand-700" : "text-slate-500",
              )}
            >
              {col.leads.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {col.leads.map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className={cn(
                  "block rounded-xl border bg-white p-3.5 transition-shadow hover:shadow-[0_8px_20px_-12px_rgba(10,27,20,.35)]",
                  col.positive ? "border-brand-100" : "border-slate-200",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13.5px] font-bold text-ink">{l.name}</span>
                  <ScoreBadge score={l.score} />
                </div>
                <span className="mt-1 block font-mono text-[11.5px] text-slate-400">
                  {formatPhone(l.phone)}
                </span>
                {l.lastMessage && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                    {l.lastMessage}
                  </p>
                )}
              </Link>
            ))}
            {col.leads.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">
                vazio
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
