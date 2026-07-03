"use client";

import { memo, useMemo, useRef, useState } from "react";
import { CheckSquare, Search, Trash2, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type {
  InboxFilter,
  InboxConversation,
  InboxCounts,
  InboxNumber,
} from "@/server/services/inbox.service";

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
  numbers,
  selectedNumber,
  onSelectNumber,
  selectedId,
  onSelect,
  loading,
  onDeleteConversations,
}: {
  conversations: InboxConversation[];
  counts: InboxCounts | null;
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  numbers: InboxNumber[];
  selectedNumber: string | null;
  onSelectNumber: (id: string | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  /** Exclui as conversas (leads) selecionadas. Ausente = ação indisponível. */
  onDeleteConversations?: (ids: string[]) => Promise<void>;
}) {
  const numberLabel = (n: InboxNumber) => n.displayName?.trim() || n.label;
  function badgeFor(key: InboxFilter): number | null {
    if (!counts) return null;
    if (key === "fila") return counts.fila;
    if (key === "minhas") return counts.minhas;
    if (key === "ia") return counts.ia;
    return null;
  }

  // Busca local por nome ou telefone. A lista já vem inteira do servidor, então
  // filtramos no cliente (instantâneo, sem nova chamada). O telefone é comparado
  // só por dígitos, ignorando +55, parênteses e traços da formatação.
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return conversations;
    const lower = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    return conversations.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        (digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [conversations, search]);

  // Seleção em lote (excluir conversas).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }
  // "Selecionar todas" alterna sobre o que está visível no filtro/busca atual.
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  // Virtualização: renderiza só as conversas visíveis (+ overscan). Mantém o
  // scroll fluido mesmo com milhares de itens no inbox. Altura é medida por item
  // (cards têm altura variável — última mensagem, badges).
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });
  const showList = !(loading && conversations.length === 0) && filtered.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Busca por nome ou telefone. */}
      <div className="shrink-0 border-b border-slate-100 p-2">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Seletor de número: divide as conversas por chip (ex.: cada cartório).
          Só aparece com mais de um número — com um só não há o que dividir. */}
      {numbers.length > 1 && (
        <div className="scroll-tabs flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 p-2">
          <button
            onClick={() => onSelectNumber(null)}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
              selectedNumber === null
                ? "bg-ink text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-ink",
            )}
          >
            Todos
          </button>
          {numbers.map((n) => (
            <button
              key={n.id}
              onClick={() => onSelectNumber(n.id)}
              title={numberLabel(n)}
              className={cn(
                "max-w-[140px] shrink-0 truncate rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                selectedNumber === n.id
                  ? "bg-ink text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-ink",
              )}
            >
              {numberLabel(n)}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-tabs flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 p-2">
        {TABS.map((t) => {
          const n = badgeFor(t.key);
          return (
            <button
              key={t.key}
              onClick={() => onFilter(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
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

      {/* Barra de seleção em lote. */}
      {onDeleteConversations && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
          {selectMode ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {selected.size} selecionada(s)
                </span>
                <button
                  type="button"
                  onClick={toggleSelectAllVisible}
                  disabled={filtered.length === 0}
                  className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40"
                >
                  {allVisibleSelected ? "Limpar seleção" : "Selecionar todas"}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 size={13} /> Excluir
                </Button>
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink"
            >
              <CheckSquare size={13} /> Selecionar
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {search.trim() ? "Nenhuma conversa encontrada." : "Nenhuma conversa aqui."}
          </p>
        ) : null}
        {showList && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const c = filtered[vi.index];
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
                    selectMode={selectMode}
                    selected={selected.has(c.id)}
                    onToggleSelect={toggleSelect}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Excluir ${selected.size} conversa(s)`}
        confirmLabel="Excluir"
        message={
          <>
            Isto apaga <strong>permanentemente</strong> {selected.size} conversa(s) e
            todo o histórico dos leads — mensagens, qualificação e agendamentos. Use
            para limpar números de teste/spam, não para arquivar clientes reais. Esta
            ação não pode ser desfeita.
          </>
        }
        onConfirm={async () => {
          if (!onDeleteConversations) return;
          await onDeleteConversations([...selected]);
          setConfirmOpen(false);
          exitSelectMode();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
});
