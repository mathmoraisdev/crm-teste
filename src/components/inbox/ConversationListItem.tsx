"use client";

import { memo } from "react";
import { Check, Eye } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { formatPhone } from "@/lib/phone";
import { timeAgo, cn } from "@/lib/utils";
import type { AttendanceStatus } from "@prisma/client";
import type { InboxConversation } from "@/server/services/inbox.service";

export const ATTENDANCE_META: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  IA: { label: "IA", tone: "blue" },
  FILA: { label: "Na fila", tone: "amber" },
  ATENDENDO: { label: "Atendendo", tone: "violet" },
  AGUARDANDO: { label: "Aguardando", tone: "slate" },
  RESOLVIDA: { label: "Resolvida", tone: "green" },
};

// Tempo de espera compacto p/ o selo de SLA ("3min", "1h20", "2d").
function formatWait(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rem = min % 60;
    return rem ? `${h}h${String(rem).padStart(2, "0")}` : `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
}

// memo: numa lista de conversas, só re-renderiza o item cujo `conversation`,
// `active` ou `onSelect` mudou (não a lista inteira a cada poll). `onSelect`
// recebe o id e é estável no pai (não mais um arrow inline por item).
export const ConversationListItem = memo(function ConversationListItem({
  conversation,
  active,
  onSelect,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  conversation: InboxConversation;
  active: boolean;
  onSelect: (id: string) => void;
  /** Modo de seleção em lote: o clique marca/desmarca em vez de abrir. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const meta = ATTENDANCE_META[conversation.attendanceStatus];
  // Conversa ainda aguardando 1ª resposta humana → mostra o selo de espera.
  const waiting = !!conversation.queuedAt && !conversation.firstResponseAt;
  const sla = conversation.sla;
  const breached = waiting && sla.status === "breached";
  return (
    <button
      onClick={() =>
        selectMode ? onToggleSelect?.(conversation.id) : onSelect(conversation.id)
      }
      className={cn(
        "flex w-full items-start gap-2.5 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50",
        // Seleção: no dark, brand-50 (que NÃO inverte) clareava a linha e lavava o
        // texto claro. dark:bg-brand-400/15 tinge de verde SEM clarear → contraste ok.
        active && !selectMode && "bg-brand-50/60 dark:bg-brand-400/15",
        selected && "bg-brand-50/60 dark:bg-brand-400/15",
        // Estouro de SLA: destaque de urgência (barra + leve fundo), some ao responder.
        breached && "border-l-2 border-l-danger bg-danger-surface/40",
      )}
    >
      {selectMode && (
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            selected
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-line-default bg-card",
          )}
          aria-hidden
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {conversation.unread && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Não lida" />
          )}
          <span
            className={cn(
              "truncate text-sm text-ink",
              conversation.unread ? "font-bold" : "font-semibold",
            )}
          >
            {conversation.name}
          </span>
          {conversation.viewers.length > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-surface px-1.5 py-0.5 text-[10px] font-medium text-info"
              title={`${conversation.viewers.map((v) => v.name).join(", ")} ${
                conversation.viewers.length > 1 ? "estão vendo" : "está vendo"
              }`}
            >
              <Eye size={10} />
              {conversation.viewers.length > 1 ? conversation.viewers.length : conversation.viewers[0].name}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">
          {conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : ""}
        </span>
      </div>
      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
        {formatPhone(conversation.phone)}
      </p>
      {conversation.lastMessage && (
        <p className="mt-1 line-clamp-1 text-xs text-slate-500">{conversation.lastMessage}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {waiting && sla.status !== "ok" && (
          <Badge tone={sla.status === "breached" ? "red" : "amber"}>
            {sla.status === "breached" ? "SLA " : ""}⏱ {formatWait(sla.waitingMs)}
          </Badge>
        )}
        <LeadStatusBadge status={conversation.status} />
        {conversation.optOut && <Badge tone="red">Opt-out</Badge>}
        {conversation.assignedTo && (
          <span className="text-[11px] text-slate-400">{conversation.assignedTo.name}</span>
        )}
        {conversation.whatsAppNumber && (
          <span className="text-[11px] text-slate-400">· {conversation.whatsAppNumber}</span>
        )}
      </div>
      </div>
    </button>
  );
});
