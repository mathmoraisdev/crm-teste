"use client";

import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type { InboxFilter, InboxConversation, InboxCounts } from "@/server/services/inbox.service";

const TABS: { key: InboxFilter; label: string }[] = [
  { key: "fila", label: "Fila" },
  { key: "minhas", label: "Minhas" },
  { key: "todas", label: "Todas" },
  { key: "resolvidas", label: "Resolvidas" },
];

export function ConversationList({
  conversations,
  counts,
  filter,
  onFilter,
  selectedId,
  onSelect,
  loading,
}: {
  conversations: InboxConversation[];
  counts: InboxCounts | null;
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  function badgeFor(key: InboxFilter): number | null {
    if (!counts) return null;
    if (key === "fila") return counts.fila;
    if (key === "minhas") return counts.minhas;
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-slate-100 p-2">
        {TABS.map((t) => {
          const n = badgeFor(t.key);
          return (
            <button
              key={t.key}
              onClick={() => onFilter(t.key)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                filter === t.key
                  ? "bg-brand-500 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-ink",
              )}
            >
              {t.label}
              {n !== null && n > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px]",
                    filter === t.key ? "bg-white/25" : "bg-slate-200 text-slate-600",
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Carregando…</p>
        ) : conversations.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Nenhuma conversa aqui.</p>
        ) : (
          conversations.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              active={c.id === selectedId}
              onSelect={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
