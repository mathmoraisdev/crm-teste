"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List, RefreshCw, Plus, Search, X, Tag as TagIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadsTable } from "@/components/LeadsTable";
import { LeadForm } from "@/components/LeadForm";
import { CsvUpload } from "@/components/CsvUpload";
import { PipelineBoard } from "@/components/PipelineBoard";
import { TagManagerModal } from "@/components/TagManagerModal";
import { StatCard } from "@/components/app/StatCard";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/use-debounced";
import { useTenantStream } from "@/lib/use-tenant-stream";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import type { LeadStatus } from "@prisma/client";
import type { LeadListItem } from "@/server/services/lead.service";
import type { LeadFacets } from "@/server/services/lead-facets.service";

type View = "table" | "board";
const NO_CAMPAIGN = "__none__";
const TAKE = 50;

const selectClass =
  "min-w-[140px] flex-1 rounded-xl border border-line-default bg-inset px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 sm:flex-none";

export function LeadsDashboard() {
  // Lista PAGINADA (server-side): página atual em `items`, total filtrado em `total`.
  const [items, setItems] = useState<LeadListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const skipRef = useRef(0);
  const itemsRef = useRef<LeadListItem[] | null>(null);
  // Facetas (status/campanhas/tags) — fonte própria, não derivadas da lista.
  const [facets, setFacets] = useState<LeadFacets | null>(null);

  const [view, setView] = useState<View>("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<LeadListItem | null>(null);
  const [deleting, setDeleting] = useState<LeadListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabels>({});

  // filtros (aplicados NO SERVIDOR via query params)
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [optOutFilter, setOptOutFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string>("ALL");
  // Debounce na busca textual: não dispara fetch a cada tecla.
  const debouncedQuery = useDebounced(query, 350);

  useEffect(() => {
    skipRef.current = skip;
  }, [skip]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const buildParams = useCallback(
    (skipArg: number) => {
      const p = new URLSearchParams();
      p.set("skip", String(skipArg));
      p.set("take", String(TAKE));
      if (debouncedQuery.trim()) p.set("q", debouncedQuery.trim());
      if (statusFilter !== "ALL") p.set("status", statusFilter);
      if (campaignFilter === NO_CAMPAIGN) p.set("campaignId", "none");
      else if (campaignFilter !== "ALL") p.set("campaignId", campaignFilter);
      if (optOutFilter !== "ALL") p.set("optOut", String(optOutFilter === "optout"));
      if (tagFilter !== "ALL") p.set("tagId", tagFilter);
      return p.toString();
    },
    [debouncedQuery, statusFilter, campaignFilter, optOutFilter, tagFilter],
  );

  const loadPage = useCallback(
    async (skipArg: number, append: boolean) => {
      try {
        const res = await fetch(`/api/leads?${buildParams(skipArg)}`, { cache: "no-store" });
        const data = await res.json();
        setItems((prev) => (append && prev ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
      } catch {
        // mantém o estado anterior em caso de falha de rede transiente
      }
    },
    [buildParams],
  );

  const loadFacets = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/facets", { cache: "no-store" });
      setFacets(await res.json());
    } catch {
      // facetas são best-effort; mantém as anteriores
    }
  }, []);

  // Qualquer mudança de filtro reseta a paginação e recarrega a 1ª página.
  useEffect(() => {
    setSkip(0);
    loadPage(0, false);
  }, [loadPage]);

  // Facetas: carga inicial (recarregadas após mutações via refresh()).
  useEffect(() => {
    loadFacets();
  }, [loadFacets]);

  // Polling de FALLBACK (30s) — só revalida a 1ª página e não atropela quem
  // paginou. Em produção com Redis o SSE (abaixo) cobre o tempo real; este
  // intervalo só protege contra SSE indisponível (sem Redis / conexão caída).
  useEffect(() => {
    const t = setInterval(() => {
      if (skipRef.current === 0) loadPage(0, false);
    }, 30000);
    return () => clearInterval(t);
  }, [loadPage]);

  // Tempo real: ao receber evento da conta, revalida 1ª página + facetas na hora.
  useTenantStream(() => {
    if (skipRef.current === 0) loadPage(0, false);
    loadFacets();
  });

  // Rótulos renomeados do funil (uma vez).
  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPipelineLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  const statusMeta = useMemo(() => resolveStatusMeta(pipelineLabels), [pipelineLabels]);

  // Recarrega 1ª página + facetas após uma mutação (criar/editar/excluir/mover/tags).
  const refresh = useCallback(() => {
    setSkip(0);
    loadPage(0, false);
    loadFacets();
  }, [loadPage, loadFacets]);

  async function manualRefresh() {
    setRefreshing(true);
    await Promise.all([loadPage(0, false), loadFacets()]);
    setSkip(0);
    setRefreshing(false);
  }

  function loadMore() {
    const next = skip + TAKE;
    setSkip(next);
    loadPage(next, true);
  }

  // Stats do funil vêm das facetas (contagem real no banco, não da página atual).
  const stats = useMemo(() => {
    if (!facets) return null;
    const by = (s: string) => facets.byStatus[s] ?? 0;
    return {
      total: facets.total,
      contatados: facets.total - by("NOVO"),
      qualificados: by("QUALIFICADO") + by("REUNIAO_AGENDADA"),
      reunioes: by("REUNIAO_AGENDADA"),
    };
  }, [facets]);

  const hasFilters =
    query.trim() !== "" ||
    statusFilter !== "ALL" ||
    campaignFilter !== "ALL" ||
    optOutFilter !== "ALL" ||
    tagFilter !== "ALL";

  function clearFilters() {
    setQuery("");
    setStatusFilter("ALL");
    setCampaignFilter("ALL");
    setOptOutFilter("ALL");
    setTagFilter("ALL");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao apagar lead");
    }
    refresh();
  }

  // Drag-and-drop do kanban: atualização otimista → PATCH → reverte em erro.
  // useCallback p/ identidade estável (não quebra o memo do PipelineBoard ao
  // digitar na busca). O revert lê a lista anterior via ref (sem depender de
  // `items` nas deps, que mudaria a identidade a cada fetch).
  const moveLead = useCallback(
    async (leadId: string, status: LeadStatus) => {
      const prev = itemsRef.current;
      setItems((cur) => (cur ? cur.map((l) => (l.id === leadId ? { ...l, status } : l)) : cur));
      setMoveError(null);
      try {
        const res = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Falha ao mover o lead");
        }
        loadFacets(); // o status mudou → atualiza os contadores do funil
      } catch (e) {
        setItems(prev); // reverte
        setMoveError(e instanceof Error ? e.message : "Falha ao mover o lead");
      }
    },
    [loadFacets],
  );

  const hasMore = items !== null && items.length < total;

  return (
    <div className="space-y-5">
      {/* title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
            Leads
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {items === null
              ? "—"
              : hasFilters
                ? `${items.length} de ${total} leads`
                : `${total} contatos no funil`}{" "}
            · atualização automática
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-xl bg-[#EBF0ED] p-[3px]">
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-bold transition-colors",
                view === "table"
                  ? "bg-card text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
                  : "text-slate-500 hover:text-ink",
              )}
            >
              <List size={14} /> Tabela
            </button>
            <button
              onClick={() => setView("board")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-bold transition-colors",
                view === "board"
                  ? "bg-card text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
                  : "text-slate-500 hover:text-ink",
              )}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={manualRefresh} loading={refreshing}>
            <RefreshCw size={14} /> Atualizar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Importar CSV
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> Novo lead
          </Button>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Leads no funil" value={stats?.total ?? "—"} />
        <StatCard label="Contatados" value={stats?.contatados ?? "—"} />
        <StatCard label="Qualificados" value={stats?.qualificados ?? "—"} accent />
        <StatCard label="Reuniões agendadas" value={stats?.reunioes ?? "—"} dark />
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="w-full rounded-xl border border-line-default bg-inset py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          <option value="ALL">Todos os status</option>
          {PIPELINE_ORDER.map((s) => (
            <option key={s} value={s}>
              {statusMeta[s].label}
            </option>
          ))}
        </select>
        <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className={selectClass}>
          <option value="ALL">Todas as campanhas</option>
          <option value={NO_CAMPAIGN}>Sem campanha</option>
          {(facets?.campaigns ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={optOutFilter} onChange={(e) => setOptOutFilter(e.target.value)} className={selectClass}>
          <option value="ALL">Opt-out: todos</option>
          <option value="active">Sem opt-out</option>
          <option value="optout">Só opt-out</option>
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={selectClass}>
          <option value="ALL">Todas as tags</option>
          {(facets?.tags ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={() => setTagManagerOpen(true)}>
          <TagIcon size={14} /> Gerenciar tags
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X size={14} /> Limpar
          </Button>
        )}
      </div>

      {moveError && (
        <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{moveError}</p>
      )}

      {items === null ? (
        <Card>
          <LoadingBlock label="Carregando leads…" />
        </Card>
      ) : view === "table" ? (
        <Card className="overflow-hidden">
          <LeadsTable
            leads={items}
            onEdit={setEditing}
            onDelete={setDeleting}
            labels={pipelineLabels}
          />
        </Card>
      ) : (
        <PipelineBoard leads={items} onMove={moveLead} labels={pipelineLabels} />
      )}

      {/* paginação: carrega mais sob demanda */}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={!hasMore}>
            Carregar mais ({items?.length ?? 0} de {total})
          </Button>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo lead">
        <LeadForm
          onSaved={() => {
            refresh();
            setCreateOpen(false);
          }}
        />
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar leads via CSV">
        <CsvUpload onImported={refresh} />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Editar — ${editing.name}` : "Editar lead"}
      >
        {editing && (
          <LeadForm
            lead={{
              id: editing.id,
              name: editing.name,
              phone: editing.phone,
              email: editing.email,
              status: editing.status,
              optOut: editing.optOut,
            }}
            labels={pipelineLabels}
            onSaved={() => {
              refresh();
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <TagManagerModal
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        onChanged={refresh}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Apagar lead"
        confirmLabel="Apagar"
        message={
          deleting ? (
            <>
              Apagar <strong>{deleting.name}</strong>? Toda a conversa,
              qualificação e agendamento desse lead serão removidos. Esta ação
              não pode ser desfeita.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (deleting) await remove(deleting.id);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
