"use client";

import { memo } from "react";
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

// memo: numa lista de conversas, só re-renderiza o item cujo `conversation`,
// `active` ou `onSelect` mudou (não a lista inteira a cada poll). `onSelect`
// recebe o id e é estável no pai (não mais um arrow inline por item).
export const ConversationListItem = memo(function ConversationListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: InboxConversation;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = ATTENDANCE_META[conversation.attendanceStatus];
  return (
    <button
      onClick={() => onSelect(conversation.id)}
      className={cn(
        "w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50",
        active && "bg-brand-50/60",
      )}
    >
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
        <LeadStatusBadge status={conversation.status} />
        {conversation.optOut && <Badge tone="red">Opt-out</Badge>}
        {conversation.assignedTo && (
          <span className="text-[11px] text-slate-400">{conversation.assignedTo.name}</span>
        )}
        {conversation.whatsAppNumber && (
          <span className="text-[11px] text-slate-400">· {conversation.whatsAppNumber}</span>
        )}
      </div>
    </button>
  );
});
