"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, RefreshCw, Plus, Search, X, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadsTable } from "@/components/LeadsTable";
import { LeadForm } from "@/components/LeadForm";
import { PipelineBoard } from "@/components/PipelineBoard";
import { TagManagerModal } from "@/components/TagManagerModal";
import { StatCard } from "@/components/app/StatCard";
import { cn } from "@/lib/utils";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import type { LeadStatus } from "@prisma/client";
import type { LeadListItem } from "@/server/services/lead.service";

type View = "table" | "board";
const NO_CAMPAIGN = "__none__";

const selectClass =
  "min-w-[140px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 sm:flex-none";

export function LeadsDashboard() {
  const [leads, setLeads] = useState<LeadListItem[] | null>(null);
  const [view, setView] = useState<View>("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LeadListItem | null>(null);
  const [deleting, setDeleting] = useState<LeadListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabels>({});

  // filtros
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [optOutFilter, setOptOutFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      const data = await res.json();
      setLeads(data.leads as LeadListItem[]);
    } catch {
      // mantém o estado anterior em caso de falha de rede transiente
    }
  }, []);

  // Carga inicial + polling leve a cada 4s para refletir mudanças do pipeline.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  // Rótulos renomeados do funil (uma vez).
  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPipelineLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  const statusMeta = useMemo(() => resolveStatusMeta(pipelineLabels), [pipelineLabels]);

  async function manualRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Campanhas presentes nos leads, para o filtro (sem fetch extra).
  const campaignNames = useMemo(() => {
    if (!leads) return [];
    return [...new Set(leads.map((l) => l.campaignName).filter((n): n is string => !!n))].sort();
  }, [leads]);

  // Tags presentes nos leads, para o filtro (sem fetch extra).
  const tagOptions = useMemo(() => {
    if (!leads) return [];
    const map = new Map<string, string>();
    for (const l of leads) for (const t of l.tags) map.set(t.id, t.name);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [leads]);

  // Métricas reais do funil (derivadas dos leads carregados).
  const stats = useMemo(() => {
    if (!leads) return null;
    const by = (s: string) => leads.filter((l) => l.status === s).length;
    return {
      total: leads.length,
      contatados: leads.filter((l) => l.status !== "NOVO").length,
      qualificados: by("QUALIFICADO") + by("REUNIAO_AGENDADA"),
      reunioes: by("REUNIAO_AGENDADA"),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    if (!leads) return null;
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "ALL" && l.status !== statusFilter) return false;
      if (campaignFilter === NO_CAMPAIGN && l.campaignName) return false;
      if (campaignFilter !== "ALL" && campaignFilter !== NO_CAMPAIGN && l.campaignName !== campaignFilter)
        return false;
      if (optOutFilter === "active" && l.optOut) return false;
      if (optOutFilter === "optout" && !l.optOut) return false;
      if (tagFilter !== "ALL" && !l.tags.some((t) => t.id === tagFilter)) return false;
      if (q && !l.name.toLowerCase().includes(q) && !l.phone.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [leads, query, statusFilter, campaignFilter, optOutFilter, tagFilter]);

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
    await load();
  }

  // Drag-and-drop do kanban: atualização otimista → PATCH → reverte em erro.
  async function moveLead(leadId: string, status: LeadStatus) {
    const prev = leads;
    setLeads((cur) =>
      cur ? cur.map((l) => (l.id === leadId ? { ...l, status } : l)) : cur,
    );
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
      load();
    } catch (e) {
      setLeads(prev); // reverte
      setMoveError(e instanceof Error ? e.message : "Falha ao mover o lead");
    }
  }

  return (
    <div className="space-y-5">
      {/* title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
            Leads
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered === null
              ? "—"
              : hasFilters
                ? `${filtered.length} de ${leads?.length ?? 0} leads`
                : `${leads?.length ?? 0} contatos no funil`}{" "}
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
                  ? "bg-white text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
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
                  ? "bg-white text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
                  : "text-slate-500 hover:text-ink",
              )}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={manualRefresh} loading={refreshing}>
            <RefreshCw size={14} /> Atualizar
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
        <StatCard
          label="Reuniões agendadas"
          value={stats?.reunioes ?? "—"}
          dark
        />
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
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
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
          {campaignNames.map((n) => (
            <option key={n} value={n}>
              {n}
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
          {tagOptions.map((t) => (
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
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{moveError}</p>
      )}

      {filtered === null ? (
        <Card>
          <LoadingBlock label="Carregando leads…" />
        </Card>
      ) : view === "table" ? (
        <Card className="overflow-hidden">
          <LeadsTable
            leads={filtered}
            onEdit={setEditing}
            onDelete={setDeleting}
            labels={pipelineLabels}
          />
        </Card>
      ) : (
        <PipelineBoard leads={filtered} onMove={moveLead} labels={pipelineLabels} />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo lead">
        <LeadForm
          onSaved={() => {
            load();
            setCreateOpen(false);
          }}
        />
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
              load();
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <TagManagerModal
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        onChanged={load}
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
