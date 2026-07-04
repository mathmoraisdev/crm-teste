"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Table, Th, Td } from "@/components/ui/Table";
import { StatCard } from "@/components/app/StatCard";
import { TrendChart } from "@/components/app/TrendChart";
import { LimitsCard } from "@/components/app/LimitsCard";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LEAD_STATUS_META, type PipelineLabels, resolveStatusMeta } from "@/lib/leadStatus";
import { cn, formatSlot } from "@/lib/utils";
import type { DashboardData } from "@/server/services/dashboard.service";

const PERIODS = [7, 30, 90];

const TONE_BAR: Record<string, string> = {
  slate: "bg-slate-300",
  blue: "bg-[#2C5BD6]",
  amber: "bg-[#B97309]",
  green: "bg-brand-500",
  red: "bg-[#C0392B]",
  violet: "bg-[#6D43D6]",
  emerald: "bg-brand-600",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (sem depender de fuso). */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

export function DashboardView() {
  const [days, setDays] = useState(30);
  // Intervalo customizado (De/Até). Quando ambos preenchidos, tem precedência
  // sobre os presets de dias.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [labels, setLabels] = useState<PipelineLabels>({});
  const [refreshing, setRefreshing] = useState(false);

  const customActive = !!from && !!to && from <= to;
  const query = useMemo(
    () => (customActive ? `from=${from}&to=${to}` : `days=${days}`),
    [customActive, from, to, days],
  );

  const load = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/dashboard?${q}`, { cache: "no-store" });
      const json = await res.json();
      setData(json.data as DashboardData);
    } catch {
      // mantém estado
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [query, load]);

  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  function selectPreset(p: number) {
    // Preset limpa o intervalo customizado.
    setFrom("");
    setTo("");
    setDays(p);
  }

  async function refresh() {
    setRefreshing(true);
    await load(query);
    setRefreshing(false);
  }

  const statusMeta = resolveStatusMeta(labels);
  const maxFunnel = data ? Math.max(1, ...data.funnel.map((f) => f.count)) : 1;
  // Rótulo do período p/ os cartões/subtítulos: intervalo customizado ou "últimos N dias".
  const rangeText = customActive ? `${brDate(from)}–${brDate(to)}` : `últimos ${days} dias`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
            Painel
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Métricas do funil, conversão e atividade.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-xl bg-[#EBF0ED] p-[3px]">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => selectPreset(p)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[13px] font-bold transition-colors",
                  !customActive && days === p
                    ? "bg-card text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
                    : "text-slate-500 hover:text-ink",
                )}
              >
                {p}d
              </button>
            ))}
          </div>

          {/* Intervalo específico (De/Até) — tem precedência sobre os presets. */}
          <div className="flex items-center gap-1.5 rounded-xl border border-line-default bg-card px-2 py-1">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Data inicial"
              className="rounded-md px-1.5 py-1 text-[13px] text-ink focus:outline-none"
            />
            <span className="text-slate-400">–</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Data final"
              className="rounded-md px-1.5 py-1 text-[13px] text-ink focus:outline-none"
            />
            {customActive && (
              <button
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className="ml-0.5 rounded-md px-1.5 py-1 text-[12px] font-semibold text-slate-500 hover:text-ink"
              >
                Limpar
              </button>
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        </div>
      </div>

      {!data ? (
        <Card>
          <LoadingBlock label="Carregando métricas…" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Leads no funil" value={data.totals.leads} delta={data.deltas.leads} />
            <StatCard
              label="Qualificados"
              value={data.totals.qualified}
              hint={`${pct(data.rates.qualifiedRate)} do total`}
              accent
            />
            <StatCard
              label="Reuniões agendadas"
              value={data.totals.meetings}
              hint={`${pct(data.rates.meetingRate)} dos qualificados`}
            />
            <StatCard
              label="Reuniões confirmadas"
              value={data.totals.confirmedMeetings}
              delta={data.deltas.confirmedMeetings}
              hint={`${rangeText}`}
              dark
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Mensagens recebidas"
              value={data.totals.inbound}
              delta={data.deltas.inbound}
              hint={`${rangeText}`}
            />
            <StatCard
              label="IA no automático"
              value={pct(data.automation.rate)}
              hint={`${data.automation.aiReplied} de ${data.automation.received} recebidas`}
              accent
            />
            <StatCard label="Mensagens enviadas" value={data.totals.outbound} hint={`${rangeText}`} />
            <StatCard
              label="Novos leads"
              value={data.newLeadsPerDay.reduce((s, p) => s + p.count, 0)}
              hint={`${rangeText}`}
            />
          </div>

          {/* Limites da conta (uso vs. teto do plano) */}
          <LimitsCard />

          {/* Tendência de atendimentos + próximos agendamentos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader
                title="Atendimentos"
                subtitle={`Recebidas vs respondidas pela IA · ${rangeText}`}
              />
              <TrendChart data={data.activityPerDay} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="Próximos agendamentos" subtitle="Confirmados e propostos" />
              {data.upcomingMeetings.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Nada agendado à frente.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.upcomingMeetings.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/leads/${m.leadId}`}
                          className="block truncate text-sm font-semibold text-ink hover:text-brand-600 hover:underline"
                        >
                          {m.leadName}
                        </Link>
                        <p className="text-xs text-slate-400">{formatSlot(m.scheduledAt)}</p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                          m.status === "CONFIRMED"
                            ? "bg-brand-50 text-brand-700"
                            : "bg-amber-50 text-amber-700",
                        )}
                      >
                        {m.status === "CONFIRMED" ? "Confirmada" : "Proposta"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Tempo de resposta: IA (automática) x atendente humano (handoff). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Resposta da IA"
              value={formatDuration(data.aiSla.avgResponseSeconds)}
              hint={
                data.aiSla.sampleSize > 0
                  ? `média de ${data.aiSla.sampleSize} resposta(s) automática(s)`
                  : "sem respostas da IA no período"
              }
              accent
            />
            <StatCard
              label="Resposta do atendente"
              value={formatDuration(data.sla.avgFirstResponseSeconds)}
              hint={
                data.sla.sampleSize > 0
                  ? `1ª resposta · média de ${data.sla.sampleSize} atendimento(s)`
                  : "sem atendimentos humanos no período"
              }
            />
          </div>

          {/* Funil */}
          <Card>
            <CardHeader title="Funil" subtitle={`Distribuição por etapa · ${rangeText}`} />
            <div className="space-y-2.5 px-4 py-4">
              {data.funnel.map((f) => {
                const meta = statusMeta[f.status];
                const tone = LEAD_STATUS_META[f.status].tone;
                return (
                  <div key={f.status} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-xs font-semibold text-slate-600">
                      {meta.label}
                    </span>
                    <div className="flex-1">
                      <div className="h-6 w-full overflow-hidden rounded-lg bg-slate-100">
                        <div
                          className={cn("h-full rounded-lg", TONE_BAR[tone] ?? "bg-slate-300")}
                          style={{ width: `${(f.count / maxFunnel) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm font-bold text-ink">
                      {f.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Por empresa */}
            <Card className="overflow-hidden">
              <CardHeader title="Por empresa" subtitle="Leads por número conectado" />
              {data.byCompany.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Sem dados.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Empresa</Th>
                      <Th className="text-right">Leads</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCompany.map((c) => (
                      <tr key={c.whatsAppNumberId ?? "none"} className="hover:bg-slate-50">
                        <Td>{c.name}</Td>
                        <Td className="text-right font-bold">{c.leads}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            {/* Por campanha */}
            <Card className="overflow-hidden">
              <CardHeader title="Por campanha" subtitle={`Envios · ${rangeText}`} />
              {data.byCampaign.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Sem envios no período.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Campanha</Th>
                      <Th className="text-right">Enviadas</Th>
                      <Th className="text-right">Falhas</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCampaign.map((c) => (
                      <tr key={c.campaignId ?? "none"} className="hover:bg-slate-50">
                        <Td>{c.name}</Td>
                        <Td className="text-right font-bold">{c.sent}</Td>
                        <Td className="text-right text-red-600">{c.failed}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          {/* Resolvidas por atendente (SLA de atendimento) */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Resolvidas por atendente"
              subtitle={`Conversas encerradas · ${rangeText}`}
            />
            {data.resolvedByAgent.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Nenhuma conversa resolvida no período.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Atendente</Th>
                    <Th className="text-right">Resolvidas</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.resolvedByAgent.map((a) => (
                    <tr key={a.agentId ?? "none"} className="hover:bg-slate-50">
                      <Td>{a.name}</Td>
                      <Td className="text-right font-bold">{a.resolved}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
