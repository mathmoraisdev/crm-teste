"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Trophy, Sparkles, Users, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadPriorityCard } from "@/components/LeadPriorityCard";
import { StatCard } from "@/components/app/StatCard";
import { useTenantStream } from "@/lib/use-tenant-stream";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@prisma/client";
import type { LeadListItem } from "@/server/services/lead.service";

/** Statuses exibidos nos filtros (exclui PAGO e DESCARTADO — leads encerrados). */
const FILTER_STATUSES: LeadStatus[] = [
  "NOVO",
  "CONTATADO",
  "EM_CONVERSA",
  "QUALIFICADO",
  "REUNIAO_AGENDADA",
  "OFERTA_ENVIADA",
];

const TAKE = 50;

// ── Chips de filtro de status ────────────────────────────────────────────────

function StatusFilterChip({
  label,
  active,
  count,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  tone: string;
  onClick: () => void;
}) {
  // Mapeia o tone do sistema de Badge para classes inline dos chips
  const activeBg: Record<string, string> = {
    slate:   "bg-slate-700 text-white border-slate-700",
    blue:    "bg-info text-white border-info",
    amber:   "bg-warning text-white border-warning",
    green:   "bg-brand-500 text-white border-brand-500",
    red:     "bg-danger text-white border-danger",
    violet:  "bg-accent text-white border-accent",
    emerald: "bg-brand-600 text-white border-brand-600",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? (activeBg[tone] ?? "bg-slate-700 text-white border-slate-700")
          : "border-line-default bg-card text-slate-600 hover:border-slate-300 hover:bg-inset",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function SalesPriorityDashboard() {
  const [items, setItems] = useState<LeadListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const skipRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabels>({});

  // Filtros de status: "ALL" = todos os ativos, ou array de status selecionados.
  const [selectedStatuses, setSelectedStatuses] = useState<LeadStatus[]>([]);

  useEffect(() => {
    skipRef.current = skip;
  }, [skip]);

  // Monta a query string para /api/leads/priority
  const buildParams = useCallback(
    (skipArg: number) => {
      const p = new URLSearchParams();
      p.set("skip", String(skipArg));
      p.set("take", String(TAKE));
      for (const s of selectedStatuses) p.append("status", s);
      return p.toString();
    },
    [selectedStatuses],
  );

  const loadPage = useCallback(
    async (skipArg: number, append: boolean) => {
      try {
        const res = await fetch(`/api/leads/priority?${buildParams(skipArg)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        setItems((prev) => (append && prev ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
      } catch {
        // mantém estado anterior em falha de rede transiente
      }
    },
    [buildParams],
  );

  // Recarrega sempre que os filtros mudam
  useEffect(() => {
    setSkip(0);
    loadPage(0, false);
  }, [loadPage]);

  // Polling de fallback (60s) — SSE cobre o tempo real com Redis
  useEffect(() => {
    const t = setInterval(() => {
      if (skipRef.current === 0) loadPage(0, false);
    }, 60_000);
    return () => clearInterval(t);
  }, [loadPage]);

  // Tempo real via SSE: revalida ao receber evento da conta
  useTenantStream(() => {
    if (skipRef.current === 0) loadPage(0, false);
  });

  // Rótulos renomeados do funil (uma vez)
  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPipelineLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  const statusMeta = useMemo(() => resolveStatusMeta(pipelineLabels), [pipelineLabels]);

  async function manualRefresh() {
    setRefreshing(true);
    setSkip(0);
    await loadPage(0, false);
    setRefreshing(false);
  }

  function loadMore() {
    const next = skip + TAKE;
    setSkip(next);
    loadPage(next, true);
  }

  function toggleStatus(s: LeadStatus) {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  // ── Stats derivados da lista atual ────────────────────────────────────────
  const stats = useMemo(() => {
    if (!items) return null;
    const highPriority = items.filter((l) => l.score >= 70).length;
    const medPriority  = items.filter((l) => l.score >= 40 && l.score < 70).length;
    const avgScore =
      items.length > 0
        ? Math.round(items.reduce((s, l) => s + l.score, 0) / items.length)
        : 0;
    return { total, highPriority, medPriority, avgScore };
  }, [items, total]);

  const hasMore = items !== null && items.length < total;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
            Fila de ligações
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Leads ordenados por score da IA — ligue para o{" "}
            <strong className="text-ink">nº 1</strong> primeiro.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={manualRefresh} loading={refreshing}>
          <RefreshCw size={14} /> Atualizar
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Leads priorizados"
          value={stats?.total ?? "—"}
          hint="qualificados pela IA"
        />
        <StatCard
          label="Alta prioridade"
          value={stats?.highPriority ?? "—"}
          hint="score ≥ 70"
          accent
        />
        <StatCard
          label="Prioridade média"
          value={stats?.medPriority ?? "—"}
          hint="score 40–69"
        />
        <StatCard
          label="Score médio"
          value={stats?.avgScore !== undefined ? `${stats.avgScore}` : "—"}
          hint="da lista filtrada"
          dark
        />
      </div>

      {/* Filtros de status */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chip "Todos" */}
          <StatusFilterChip
            label="Todos os status"
            active={selectedStatuses.length === 0}
            tone="slate"
            onClick={() => setSelectedStatuses([])}
          />

          {/* Um chip por status ativo no funil */}
          {FILTER_STATUSES.map((s) => {
            // PIPELINE_ORDER garante que só exibimos statuses do enum
            if (!PIPELINE_ORDER.includes(s)) return null;
            const meta = statusMeta[s];
            return (
              <StatusFilterChip
                key={s}
                label={meta.label}
                active={selectedStatuses.includes(s)}
                tone={meta.tone}
                onClick={() => toggleStatus(s)}
              />
            );
          })}
        </div>

        {/* Legenda da ordenação */}
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <ArrowUpDown size={11} />
          Ordenado por score descendente · leads sem qualificação da IA são omitidos
        </p>
      </div>

      {/* Lista de cards */}
      {items === null ? (
        <Card>
          <LoadingBlock label="Carregando fila de ligações…" />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
              <Sparkles size={22} className="text-brand-500" />
            </div>
            <div>
              <p className="font-semibold text-ink">Nenhum lead qualificado</p>
              <p className="mt-1 text-sm text-slate-400">
                Os leads aparecem aqui assim que a IA gerar um score durante a conversa.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Destaque: top 3 em grid e restantes em lista */}
          {items.length >= 3 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Trophy size={14} className="text-brand-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Top 3 — ligue agora
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.slice(0, 3).map((lead, i) => (
                  <LeadPriorityCard
                    key={lead.id}
                    lead={lead}
                    rank={i + 1}
                    labels={pipelineLabels}
                    onCallLogged={() => loadPage(0, false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Restante da fila */}
          {items.length > 3 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Users size={14} className="text-slate-400" />
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Fila completa
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.slice(3).map((lead, i) => (
                  <LeadPriorityCard
                    key={lead.id}
                    lead={lead}
                    rank={i + 4}
                    labels={pipelineLabels}
                    onCallLogged={() => loadPage(0, false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Menos de 3: mostra tudo junto sem divisão */}
          {items.length < 3 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((lead, i) => (
                <LeadPriorityCard
                  key={lead.id}
                  lead={lead}
                  rank={i + 1}
                  labels={pipelineLabels}
                  onCallLogged={() => loadPage(0, false)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Paginação: carregar mais */}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Carregar mais ({items?.length ?? 0} de {total})
          </Button>
        </div>
      )}
    </div>
  );
}
