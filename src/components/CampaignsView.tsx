"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Play, RefreshCw, Pencil, Trash2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Table, Th, Td } from "@/components/ui/Table";
import { LoadingBlock } from "@/components/ui/Spinner";
import { CampaignForm } from "@/components/CampaignForm";
import type { CampaignListItem } from "@/server/services/campaign.service";

const STATUS_TONE = {
  DRAFT: "slate",
  RUNNING: "amber",
  PAUSED: "red",
  COMPLETED: "green",
} as const;

const STATUS_LABEL = {
  DRAFT: "Rascunho",
  RUNNING: "Disparando",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
} as const;

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[];

export function CampaignsView({ canCampaigns = true }: { canCampaigns?: boolean }) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignListItem | null>(null);
  const [deleting, setDeleting] = useState<CampaignListItem | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // filtros
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      const data = await res.json();
      setCampaigns(data.campaigns as CampaignListItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!campaigns) return null;
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.messageTemplate.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [campaigns, query, statusFilter]);

  const hasFilters = query.trim() !== "" || statusFilter !== "ALL";

  async function start(id: string) {
    setStartingId(id);
    setFlash(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao iniciar");
      setFlash(`Campanha iniciada: ${data.enqueued} mensagens na fila de envio.`);
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Erro ao iniciar campanha");
    } finally {
      setStartingId(null);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao apagar campanha");
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-[30px] font-bold tracking-[-0.025em] text-ink">
            Campanhas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Crie uma campanha, associe os leads novos e dispare a mensagem
            inicial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} /> Atualizar
          </Button>
          {canCampaigns && (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> Nova campanha
            </Button>
          )}
        </div>
      </div>

      {!canCampaigns && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          Seu usuário pode acompanhar as campanhas, mas não tem permissão para criá-las ou
          dispará-las. Fale com o administrador da conta.
        </div>
      )}

      {flash && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700">
          {flash}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou mensagem…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setStatusFilter("ALL");
            }}
          >
            <X size={14} /> Limpar
          </Button>
        )}
      </div>

      {filtered === null ? (
        <Card>
          <LoadingBlock label="Carregando campanhas…" />
        </Card>
      ) : campaigns && campaigns.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhuma campanha ainda. Crie a primeira para disparar mensagens.
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhuma campanha corresponde aos filtros.
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((c) => {
              const started = c.status === "RUNNING" || c.status === "PAUSED";
              const canStart = !started && c.pendingCount > 0;
              return (
                <Card key={c.id}>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block font-bold text-ink">{c.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">
                          {c.messageTemplate}
                        </span>
                      </div>
                      <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE]}>
                        {STATUS_LABEL[c.status as keyof typeof STATUS_LABEL] ??
                          c.status}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="tabular-nums">
                        Leads: <strong className="text-ink">{c.leadCount}</strong>
                      </span>
                      <span className="tabular-nums">
                        Pendentes:{" "}
                        <strong className="text-ink">{c.pendingCount}</strong>
                      </span>
                    </div>

                    {c.jobs.total > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                        <span className="text-green-700">{c.jobs.sent} enviados</span>
                        {c.jobs.pending > 0 && (
                          <span className="text-warning">
                            {c.jobs.pending} na fila
                          </span>
                        )}
                        {c.jobs.failed > 0 && (
                          <span className="text-danger">{c.jobs.failed} falhas</span>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        size="sm"
                        onClick={() => start(c.id)}
                        loading={startingId === c.id}
                        disabled={!canStart}
                      >
                        <Play size={13} />
                        {canStart ? "Iniciar" : "Disparada"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(c)}
                        aria-label="Editar campanha"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(c)}
                        aria-label="Apagar campanha"
                        title="Apagar"
                        className="text-danger hover:bg-danger-surface"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop: table */}
          <Card className="hidden lg:block">
          <Table>
            <thead>
              <tr>
                <Th>Campanha</Th>
                <Th>Status</Th>
                <Th className="text-center">Leads</Th>
                <Th className="text-center">Pendentes</Th>
                <Th className="text-center">Fila</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const started = c.status === "RUNNING" || c.status === "PAUSED";
                const canStart = !started && c.pendingCount > 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="font-bold text-ink">{c.name}</span>
                      <span className="block max-w-md truncate text-xs text-slate-400">
                        {c.messageTemplate}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE]}>
                        {STATUS_LABEL[c.status as keyof typeof STATUS_LABEL] ??
                          c.status}
                      </Badge>
                    </Td>
                    <Td className="text-center tabular-nums">{c.leadCount}</Td>
                    <Td className="text-center tabular-nums">{c.pendingCount}</Td>
                    <Td className="text-center">
                      {c.jobs.total === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs tabular-nums">
                          <span className="text-green-700">
                            {c.jobs.sent} enviados
                          </span>
                          {c.jobs.pending > 0 && (
                            <span className="text-warning">
                              {c.jobs.pending} na fila
                            </span>
                          )}
                          {c.jobs.failed > 0 && (
                            <span className="text-danger">
                              {c.jobs.failed} falhas
                            </span>
                          )}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() => start(c.id)}
                          loading={startingId === c.id}
                          disabled={!canStart || !canCampaigns}
                        >
                          <Play size={13} />
                          {canStart ? "Iniciar" : "Disparada"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(c)}
                          aria-label="Editar campanha"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(c)}
                          aria-label="Apagar campanha"
                          title="Apagar"
                          className="text-danger hover:bg-danger-surface"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </Card>
        </>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nova campanha">
        <CampaignForm
          onSaved={() => {
            load();
            setFormOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Editar — ${editing.name}` : "Editar campanha"}
      >
        {editing && (
          <CampaignForm
            campaign={{
              id: editing.id,
              name: editing.name,
              messageTemplate: editing.messageTemplate,
              dailyCap: editing.dailyCap,
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
        title="Apagar campanha"
        confirmLabel="Apagar"
        message={
          deleting ? (
            <>
              Apagar <strong>{deleting.name}</strong>? Os leads serão
              desvinculados (preservados) e os envios ainda na fila serão
              cancelados. Esta ação não pode ser desfeita.
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
