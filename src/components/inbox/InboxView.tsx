"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, ExternalLink, Hand } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConversationView } from "@/components/ConversationView";
import { QualificationPanel } from "@/components/QualificationPanel";
import { TagPicker } from "@/components/TagPicker";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ATTENDANCE_META } from "@/components/inbox/ConversationListItem";
import { formatPhone } from "@/lib/phone";
import type {
  InboxFilter,
  InboxConversation,
  InboxCounts,
} from "@/server/services/inbox.service";
import type { LeadDetail } from "@/server/services/lead.service";

export function InboxView() {
  const [filter, setFilter] = useState<InboxFilter>("todas");
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const loadList = useCallback(async (f: InboxFilter) => {
    try {
      const res = await fetch(`/api/inbox?filter=${f}`, { cache: "no-store" });
      const data = await res.json();
      setConversations((data.conversations as InboxConversation[]) ?? []);
      setCounts((data.counts as InboxCounts) ?? null);
      setMe((data.me as string) ?? null);
    } catch {
      // mantém estado
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    setLoadingList(true);
    loadList(filter);
    const t = setInterval(() => loadList(filter), 4000);
    return () => clearInterval(t);
  }, [filter, loadList]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/leads/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (selectedRef.current === id) setDetail(data.lead as LeadDetail);
    } catch {
      // mantém estado
    }
  }, []);

  // Polling do detalhe selecionado (ver novas mensagens / mudança de estado).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
    const t = setInterval(() => loadDetail(selectedId), 3000);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  async function select(id: string) {
    setSelectedId(id);
    setDetail(null);
    setActionError(null);
    // Marca como lida e atualiza a lista (apaga a bolinha).
    try {
      await fetch(`/api/inbox/${id}/read`, { method: "POST" });
    } catch {
      // não bloqueia a abertura
    }
    loadList(filter);
  }

  async function act(
    path: string,
    body?: Record<string, unknown>,
  ) {
    if (!selectedId) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha na ação");
      await Promise.all([loadDetail(selectedId), loadList(filter)]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erro na ação");
    } finally {
      setActing(false);
    }
  }

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;
  const isMine = !!selectedConv?.assignedTo && selectedConv.assignedTo.id === me;
  const assignedLabel = selectedConv?.assignedTo
    ? selectedConv.assignedTo.id === me
      ? "Você"
      : selectedConv.assignedTo.name
    : null;
  const meta = selectedConv ? ATTENDANCE_META[selectedConv.attendanceStatus] : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
          Atendimento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Fila, atribuição e respostas — handoff IA ↔ humano.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_330px]">
        {/* Esquerda: lista */}
        <Card className="h-[75vh] overflow-hidden p-0">
          <ConversationList
            conversations={conversations}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={select}
            loading={loadingList}
          />
        </Card>

        {/* Centro: conversa */}
        <Card className="flex h-[75vh] flex-col overflow-hidden p-0">
          {!detail || !selectedConv ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Selecione uma conversa.
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold text-ink">{detail.name}</span>
                      {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatPhone(detail.phone)}
                      {selectedConv.whatsAppNumber && <> · {selectedConv.whatsAppNumber}</>}
                      {assignedLabel && <> · {assignedLabel}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!isMine && (
                      <Button
                        size="sm"
                        onClick={() => act(`/api/inbox/${selectedId}/assign`)}
                        loading={acting}
                      >
                        <Hand size={14} /> Assumir
                      </Button>
                    )}
                    {detail.aiPaused && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => act(`/api/leads/${selectedId}/handoff`, { paused: false })}
                        loading={acting}
                      >
                        <Bot size={14} /> Devolver à IA
                      </Button>
                    )}
                    {selectedConv.attendanceStatus !== "RESOLVIDA" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => act(`/api/inbox/${selectedId}/resolve`, { returnToAi: true })}
                        loading={acting}
                      >
                        <CheckCircle2 size={14} /> Resolver
                      </Button>
                    )}
                  </div>
                </div>
                {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              </div>

              <div className="min-h-0 flex-1">
                <ConversationView
                  leadId={detail.id}
                  messages={detail.messages}
                  onReplied={() => {
                    loadDetail(detail.id);
                    loadList(filter);
                  }}
                  canReply
                  aiPaused={detail.aiPaused}
                  hideHandoff
                />
              </div>
            </>
          )}
        </Card>

        {/* Direita: painel do lead */}
        <div className="h-[75vh] overflow-y-auto">
          {detail ? (
            <div className="space-y-4">
              <Card className="p-3">
                <TagPicker
                  leadId={detail.id}
                  value={detail.tags}
                  onChange={(tags) => setDetail((p) => (p ? { ...p, tags } : p))}
                />
                <Link
                  href={`/leads/${detail.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <ExternalLink size={13} /> Abrir no CRM
                </Link>
              </Card>
              <QualificationPanel
                qualification={detail.qualification}
                meeting={detail.meeting}
                customFields={detail.customFields}
              />
            </div>
          ) : (
            <Card className="flex h-full items-center justify-center text-sm text-slate-400">
              —
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
