"use client";

import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type { InboxFilter, InboxConversation, InboxCounts } from "@/server/services/inbox.service";

const TABS: { key: InboxFilter; label: string }[] = [
  { key: "fila", label: "Fila" },
  { key: "minhas", label: "Minhas" },
  { key: "ia", label: "IA" },
  { key: "todas", label: "Todas" },
  { key: "resolvidas", label: "Resolvidas" },
];

export const ConversationList = memo(function ConversationList({
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
    if (key === "ia") return counts.ia;
    return null;
  }

  // Virtualização: renderiza só as conversas visíveis (+ overscan). Mantém o
  // scroll fluido mesmo com milhares de itens no inbox. Altura é medida por item
  // (cards têm altura variável — última mensagem, badges).
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });
  const showList = !(loading && conversations.length === 0) && conversations.length > 0;

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

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Carregando…</p>
        ) : conversations.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Nenhuma conversa aqui.</p>
        ) : null}
        {showList && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const c = conversations[vi.index];
              return (
                <div
                  key={c.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ConversationListItem
                    conversation={c}
                    active={c.id === selectedId}
                    onSelect={onSelect}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
