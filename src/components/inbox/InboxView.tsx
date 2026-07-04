"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, ExternalLink, Hand, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConversationView } from "@/components/ConversationView";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { QualificationPanel } from "@/components/QualificationPanel";
import { TagPicker } from "@/components/TagPicker";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ATTENDANCE_META } from "@/components/inbox/ConversationListItem";
import { useTenantStream } from "@/lib/use-tenant-stream";
import { formatPhone } from "@/lib/phone";
import type {
  InboxFilter,
  InboxConversation,
  InboxCounts,
  InboxNumber,
} from "@/server/services/inbox.service";
import type { LeadDetail } from "@/server/services/lead.service";

export function InboxView() {
  const [filter, setFilter] = useState<InboxFilter>("todas");
  // Seletor de número: null = todos os chips juntos; id = só aquele número.
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<InboxNumber[]>([]);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  // Ref p/ loadList ler o número atual sem precisar entrar na lista de deps.
  const numberRef = useRef<string | null>(selectedNumber);
  numberRef.current = selectedNumber;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const loadList = useCallback(async (f: InboxFilter) => {
    try {
      const n = numberRef.current;
      const url = `/api/inbox?filter=${f}${n ? `&number=${encodeURIComponent(n)}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      setConversations((data.conversations as InboxConversation[]) ?? []);
      setCounts((data.counts as InboxCounts) ?? null);
      setNumbers((data.numbers as InboxNumber[]) ?? []);
      setMe((data.me as string) ?? null);
    } catch {
      // mantém estado
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Polling de FALLBACK (30s): com Redis o SSE abaixo cobre o tempo real; este
  // intervalo protege contra SSE indisponível. Recarrega ao trocar de número.
  useEffect(() => {
    setLoadingList(true);
    loadList(filter);
    const t = setInterval(() => loadList(filter), 30000);
    return () => clearInterval(t);
  }, [filter, selectedNumber, loadList]);

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

  // Polling de FALLBACK do detalhe selecionado (30s) — o SSE revalida na hora.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
    const t = setInterval(() => loadDetail(selectedId), 30000);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  // Tempo real: evento da conta → revalida a lista e o detalhe aberto na hora.
  useTenantStream(() => {
    loadList(filter);
    if (selectedRef.current) loadDetail(selectedRef.current);
  });

  // Deep-link vindo do CRM (/inbox?c=<leadId>): pré-seleciona a conversa e marca
  // como lida. Abre em "Todas" p/ maximizar a chance de a conversa estar na
  // lista; se estiver fora do filtro (ex.: resolvida), o painel central ainda
  // renderiza a partir do `detail` carregado direto por id (guard abaixo).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (!id) return;
    setFilter("todas");
    setSelectedId(id);
    fetch(`/api/inbox/${id}/read`, { method: "POST" }).catch(() => {});
    // roda só na montagem — leitura única do parâmetro
  }, []);

  // useCallback: identidade estável p/ a ConversationList memoizada não
  // re-renderizar a cada poll (4s) por causa de um novo onSelect.
  const select = useCallback(
    async (id: string) => {
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
    },
    [filter, loadList],
  );

  // Exclusão em lote: apaga cada lead (endpoint tenant-guarded que cascateia
  // mensagens/qualificação/agenda). Se a conversa aberta foi apagada, limpa o
  // detalhe. Recarrega a lista ao final e sinaliza falhas parciais.
  const deleteConversations = useCallback(
    async (ids: string[]) => {
      // Lotes de 5 p/ não inundar o pooler do banco quando muitas são apagadas.
      let failed = 0;
      for (let i = 0; i < ids.length; i += 5) {
        const chunk = ids.slice(i, i + 5);
        const results = await Promise.allSettled(
          chunk.map(async (id) => {
            const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error();
          }),
        );
        failed += results.filter((r) => r.status === "rejected").length;
      }
      if (selectedRef.current && ids.includes(selectedRef.current)) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList(filter);
      if (failed > 0) throw new Error(`${failed} conversa(s) não puderam ser excluídas.`);
    },
    [filter, loadList],
  );

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
  // Deep-link do CRM pode abrir uma conversa fora do filtro atual: aí
  // `selectedConv` é null e usamos o próprio `detail` como fonte do atendimento.
  const attendanceStatus = selectedConv?.attendanceStatus ?? detail?.attendanceStatus ?? null;
  const assignedToId = selectedConv?.assignedTo?.id ?? detail?.assignedToId ?? null;
  const isMine = !!assignedToId && assignedToId === me;
  const assignedLabel = selectedConv?.assignedTo
    ? selectedConv.assignedTo.id === me
      ? "Você"
      : selectedConv.assignedTo.name
    : assignedToId
      ? assignedToId === me
        ? "Você"
        : null
      : null;
  const meta = attendanceStatus ? ATTENDANCE_META[attendanceStatus] : null;

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
            numbers={numbers}
            selectedNumber={selectedNumber}
            onSelectNumber={setSelectedNumber}
            selectedId={selectedId}
            onSelect={select}
            loading={loadingList}
            onDeleteConversations={deleteConversations}
          />
        </Card>

        {/* Centro: conversa */}
        <Card className="flex h-[75vh] flex-col overflow-hidden p-0">
          {!detail ? (
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
                      <LeadStatusBadge status={detail.status} />
                      {detail.optOut && <Badge tone="red">Opt-out</Badge>}
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatPhone(detail.phone)}
                      {selectedConv?.whatsAppNumber && <> · {selectedConv.whatsAppNumber}</>}
                      {assignedLabel && <> · {assignedLabel}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(detail.status === "DESCARTADO" || detail.optOut) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Este contato foi descartado/opt-out (pediu para não ser abordado). Reativar libera a IA e as campanhas para ele novamente. Confirmar?",
                            )
                          ) {
                            act(`/api/leads/${selectedId}/reactivate`);
                          }
                        }}
                        loading={acting}
                      >
                        <RotateCcw size={14} /> Reativar
                      </Button>
                    )}
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
                    {attendanceStatus !== "RESOLVIDA" && (
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
                {actionError && <p className="mt-2 text-xs text-danger">{actionError}</p>}
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
