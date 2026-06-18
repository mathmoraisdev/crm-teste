"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Upload, RefreshCw, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadsTable } from "@/components/LeadsTable";
import { LeadForm } from "@/components/LeadForm";
import { PipelineBoard } from "@/components/PipelineBoard";
import { CsvUpload } from "@/components/CsvUpload";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_META, PIPELINE_ORDER } from "@/lib/leadStatus";
import type { LeadListItem } from "@/server/services/lead.service";

type View = "table" | "board";
const NO_CAMPAIGN = "__none__";

export function LeadsDashboard() {
  const [leads, setLeads] = useState<LeadListItem[] | null>(null);
  const [view, setView] = useState<View>("table");
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LeadListItem | null>(null);
  const [deleting, setDeleting] = useState<LeadListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // filtros
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [optOutFilter, setOptOutFilter] = useState<string>("ALL");

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
      if (q && !l.name.toLowerCase().includes(q) && !l.phone.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [leads, query, statusFilter, campaignFilter, optOutFilter]);

  const hasFilters =
    query.trim() !== "" ||
    statusFilter !== "ALL" ||
    campaignFilter !== "ALL" ||
    optOutFilter !== "ALL";

  function clearFilters() {
    setQuery("");
    setStatusFilter("ALL");
    setCampaignFilter("ALL");
    setOptOutFilter("ALL");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao apagar lead");
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-slate-500">
            {filtered === null
              ? "—"
              : hasFilters
                ? `${filtered.length} de ${leads?.length ?? 0} leads`
                : `${leads?.length ?? 0} leads no funil`}{" "}
            · atualização automática
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium",
                view === "table"
                  ? "bg-brand-500 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <List size={14} /> Tabela
            </button>
            <button
              onClick={() => setView("board")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium",
                view === "board"
                  ? "bg-brand-500 text-white"
                  : "text-slate-600 hover:bg-slate-100",
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

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">Todos os status</option>
          {PIPELINE_ORDER.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">Todas as campanhas</option>
          <option value={NO_CAMPAIGN}>Sem campanha</option>
          {campaignNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={optOutFilter}
          onChange={(e) => setOptOutFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">Opt-out: todos</option>
          <option value="active">Sem opt-out</option>
          <option value="optout">Só opt-out</option>
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X size={14} /> Limpar
          </Button>
        )}
      </div>

      {filtered === null ? (
        <Card>
          <LoadingBlock label="Carregando leads…" />
        </Card>
      ) : view === "table" ? (
        <Card>
          <LeadsTable leads={filtered} onEdit={setEditing} onDelete={setDeleting} />
        </Card>
      ) : (
        <PipelineBoard leads={filtered} />
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar leads (CSV)">
        <CsvUpload
          onImported={() => {
            load();
            setTimeout(() => setImportOpen(false), 1500);
          }}
        />
      </Modal>

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
              status: editing.status,
              optOut: editing.optOut,
            }}
            onSaved={() => {
              load();
              setEditing(null);
            }}
          />
        )}
      </Modal>

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
