"use client";

import { memo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AttendanceStatus, LeadStatus } from "@prisma/client";
import { ScoreBadge } from "@/components/ScoreBadge";
import { TagChip } from "@/components/TagChip";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

/** Coluna em verde-claro p/ os estágios "positivos" do funil. */
const POSITIVE = new Set(["QUALIFICADO", "REUNIAO_AGENDADA"]);

/**
 * Minutos na fila a partir dos quais o card sinaliza SLA (lead esperando humano
 * há tempo demais). Só destaque visual — não altera nada no servidor.
 */
const SLA_QUEUE_MINUTES = 10;

/**
 * Estados de atendimento que o card do kanban sinaliza (IA e RESOLVIDA são o
 * "normal" e não poluem o card). Deixa o vendedor ver, sem sair do funil, que
 * aquele lead precisa de humano.
 */
const ATTENDANCE_HINT: Partial<Record<AttendanceStatus, { label: string; cls: string }>> = {
  FILA: { label: "Na fila", cls: "bg-warning-surface text-warning" },
  ATENDENDO: { label: "Atendendo", cls: "bg-accent-surface text-accent" },
  AGUARDANDO: { label: "Aguardando", cls: "bg-slate-100 text-slate-500" },
};

/** Pill de atendimento do card; vira vermelho quando a fila estoura o SLA. */
function AttendancePill({ lead }: { lead: LeadListItem }) {
  const hint = ATTENDANCE_HINT[lead.attendanceStatus];
  if (!hint) return null;
  const overdue =
    lead.attendanceStatus === "FILA" &&
    !!lead.queuedAt &&
    Date.now() - new Date(lead.queuedAt).getTime() > SLA_QUEUE_MINUTES * 60_000;
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
        overdue ? "bg-danger-surface text-danger" : hint.cls,
      )}
      title={overdue ? `Na fila há mais de ${SLA_QUEUE_MINUTES} min sem atendimento` : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {overdue ? "SLA — na fila" : hint.label}
    </span>
  );
}

/** Mover manual para estes estágios é só rótulo — não cria reunião nem aciona a IA. */
const SIDE_EFFECT_FREE_HINT: Partial<Record<LeadStatus, string>> = {
  REUNIAO_AGENDADA: "Mover manualmente só muda o rótulo — não cria reunião nem aciona a IA.",
  DESCARTADO: "Mover manualmente só muda o rótulo — não dispara a IA.",
};

/** Handlers de drag/click compartilhados, passados do board para cada card. */
interface CardHandlers {
  draggable: boolean;
  draggingId: string | null;
  positive: boolean;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
}

/** Card de lead memoizado: só re-renderiza quando seus próprios dados/estado mudam. */
const KanbanCard = memo(function KanbanCard({
  lead,
  h,
}: {
  lead: LeadListItem;
  h: CardHandlers;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={h.draggable}
      onDragStart={(e) => h.onDragStart(lead.id, e)}
      onDragEnd={h.onDragEnd}
      onClick={() => h.onOpen(lead.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          h.onOpen(lead.id);
        }
      }}
      className={cn(
        "block cursor-pointer rounded-xl border bg-card p-3.5 transition-shadow hover:shadow-[0_8px_20px_-12px_rgba(10,27,20,.35)] focus:outline-none focus:ring-2 focus:ring-brand-400",
        h.positive ? "border-brand-100" : "border-slate-200",
        h.draggingId === lead.id && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-bold text-ink">{lead.name}</span>
        <ScoreBadge score={lead.score} />
      </div>
      <span className="mt-1 block font-mono text-[11.5px] text-slate-400">
        {formatPhone(lead.phone)}
      </span>
      <AttendancePill lead={lead} />
      {lead.lastMessage && (
        <p className="mt-2 line-clamp-2 text-xs text-slate-500">{lead.lastMessage}</p>
      )}
      {lead.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.tags.map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Coluna do kanban com virtualização: renderiza só os cards visíveis (+overscan)
 * dentro de um scroll próprio de altura limitada. Mantém o drag-and-drop (cada
 * card é `draggable`). Para listas curtas o virtualizer rende tudo de qualquer
 * forma — o ganho aparece em colunas com centenas/milhares de leads.
 */
const KanbanColumn = memo(function KanbanColumn({
  status,
  label,
  positive,
  leads,
  onMove,
  handlers,
  dragOver,
  onDragOverCol,
  onDragLeaveCol,
  onDropCol,
}: {
  status: LeadStatus;
  label: string;
  positive: boolean;
  leads: LeadListItem[];
  onMove?: (leadId: string, status: LeadStatus) => void;
  handlers: CardHandlers;
  dragOver: boolean;
  onDragOverCol: (e: React.DragEvent) => void;
  onDragLeaveCol: () => void;
  onDropCol: (e: React.DragEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    // o espaçamento entre cards (space-y-2.5 ≈ 10px) é embutido no gap manual abaixo
  });

  return (
    <div
      onDragOver={onDragOverCol}
      onDragLeave={onDragLeaveCol}
      onDrop={onDropCol}
      className={cn(
        "flex max-h-[72vh] w-[78vw] max-w-[300px] flex-shrink-0 snap-start flex-col rounded-2xl p-3.5 transition-colors sm:w-[272px]",
        positive ? "bg-brand-50" : "bg-[#EFF3F1]",
        dragOver && "ring-2 ring-brand-400",
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <span
          className={cn("text-[13px] font-bold", positive ? "text-brand-700" : "text-ink")}
          title={SIDE_EFFECT_FREE_HINT[status]}
        >
          {label}
        </span>
        <span
          className={cn(
            "rounded-full bg-card px-2.5 py-0.5 text-[11px] font-bold",
            positive ? "text-brand-700" : "text-slate-500",
          )}
        >
          {leads.length}
        </span>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">
          vazio
        </div>
      ) : (
        <div ref={scrollRef} className="scroll-thin -mr-1 flex-1 overflow-y-auto pr-1">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const lead = leads[vi.index];
              return (
                <div
                  key={lead.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                    paddingBottom: 10,
                  }}
                >
                  <KanbanCard lead={lead} h={handlers} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Kanban arrastável: uma coluna por status. Soltar um card numa coluna chama
 * `onMove(leadId, status)`. Sem `onMove` o board é só leitura.
 */
export const PipelineBoard = memo(function PipelineBoard({
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

  // Handlers de card compartilhados por TODAS as colunas (identidade estável por
  // render do board — os cards memoizados só re-renderizam quando muda dragging).
  const handlers: CardHandlers = {
    draggable: !!onMove,
    draggingId,
    positive: false, // sobrescrito por coluna abaixo
    onDragStart: (id, e) => {
      draggedRef.current = true;
      setDraggingId(id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      setDraggingId(null);
      setDragOver(null);
      setTimeout(() => (draggedRef.current = false), 0);
    },
    onOpen: (id) => {
      if (draggedRef.current) return;
      router.push(`/leads/${id}`);
    },
  };

  return (
    <div className="scroll-thin -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
      {byStatus.map((col) => (
        <KanbanColumn
          key={col.status}
          status={col.status}
          label={col.meta.label}
          positive={col.positive}
          leads={col.leads}
          onMove={onMove}
          handlers={{ ...handlers, positive: col.positive }}
          dragOver={dragOver === col.status}
          onDragOverCol={(e) => {
            if (!onMove) return;
            e.preventDefault();
            setDragOver(col.status);
          }}
          onDragLeaveCol={() => setDragOver((s) => (s === col.status ? null : s))}
          onDropCol={(e) => {
            e.preventDefault();
            handleDrop(col.status);
          }}
        />
      ))}
    </div>
  );
});
