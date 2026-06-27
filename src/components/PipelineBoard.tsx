"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadStatus } from "@prisma/client";
import { ScoreBadge } from "@/components/ScoreBadge";
import { TagChip } from "@/components/TagChip";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

/** Coluna em verde-claro p/ os estágios "positivos" do funil. */
const POSITIVE = new Set(["QUALIFICADO", "REUNIAO_AGENDADA"]);

/** Mover manual para estes estágios é só rótulo — não cria reunião nem aciona a IA. */
const SIDE_EFFECT_FREE_HINT: Partial<Record<LeadStatus, string>> = {
  REUNIAO_AGENDADA: "Mover manualmente só muda o rótulo — não cria reunião nem aciona a IA.",
  DESCARTADO: "Mover manualmente só muda o rótulo — não dispara a IA.",
};

/**
 * Kanban arrastável: uma coluna por status. Soltar um card numa coluna chama
 * `onMove(leadId, status)`. Sem `onMove` o board é só leitura.
 */
export function PipelineBoard({
  leads,
  onMove,
  labels,
}: {
  leads: LeadListItem[];
  onMove?: (leadId: string, status: LeadStatus) => void;
  labels?: PipelineLabels | null;
}) {
  const router = useRouter();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);
  // Suprime o clique que o browser dispara logo após um drag concluído.
  const draggedRef = useRef(false);

  const statusMeta = resolveStatusMeta(labels);
  const byStatus = PIPELINE_ORDER.map((status) => ({
    status,
    meta: statusMeta[status],
    positive: POSITIVE.has(status),
    leads: leads.filter((l) => l.status === status),
  }));

  function handleDrop(status: LeadStatus) {
    setDragOver(null);
    const id = draggingId;
    setDraggingId(null);
    if (id && onMove) {
      const lead = leads.find((l) => l.id === id);
      if (lead && lead.status !== status) onMove(id, status);
    }
  }

  return (
    <div className="scroll-thin -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
      {byStatus.map((col) => (
        <div
          key={col.status}
          onDragOver={(e) => {
            if (!onMove) return;
            e.preventDefault();
            setDragOver(col.status);
          }}
          onDragLeave={() => setDragOver((s) => (s === col.status ? null : s))}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(col.status);
          }}
          className={cn(
            "w-[78vw] max-w-[300px] flex-shrink-0 snap-start rounded-2xl p-3.5 transition-colors sm:w-[272px]",
            col.positive ? "bg-brand-50" : "bg-[#EFF3F1]",
            dragOver === col.status && "ring-2 ring-brand-400",
          )}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <span
              className={cn(
                "text-[13px] font-bold",
                col.positive ? "text-brand-700" : "text-ink",
              )}
              title={SIDE_EFFECT_FREE_HINT[col.status]}
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
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                draggable={!!onMove}
                onDragStart={(e) => {
                  draggedRef.current = true;
                  setDraggingId(l.id);
                  e.dataTransfer.setData("text/plain", l.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOver(null);
                  // libera o clique no próximo tick
                  setTimeout(() => (draggedRef.current = false), 0);
                }}
                onClick={() => {
                  if (draggedRef.current) return;
                  router.push(`/leads/${l.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/leads/${l.id}`);
                  }
                }}
                className={cn(
                  "block cursor-pointer rounded-xl border bg-white p-3.5 transition-shadow hover:shadow-[0_8px_20px_-12px_rgba(10,27,20,.35)] focus:outline-none focus:ring-2 focus:ring-brand-400",
                  col.positive ? "border-brand-100" : "border-slate-200",
                  draggingId === l.id && "opacity-50",
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
                {l.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {l.tags.map((t) => (
                      <TagChip key={t.id} name={t.name} color={t.color} />
                    ))}
                  </div>
                )}
              </div>
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
