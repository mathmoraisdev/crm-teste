"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Table, Th, Td } from "@/components/ui/Table";
import { StatCard } from "@/components/app/StatCard";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LEAD_STATUS_META, type PipelineLabels, resolveStatusMeta } from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [labels, setLabels] = useState<PipelineLabels>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/dashboard?days=${d}`, { cache: "no-store" });
      const json = await res.json();
      setData(json.data as DashboardData);
    } catch {
      // mantém estado
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  async function refresh() {
    setRefreshing(true);
    await load(days);
    setRefreshing(false);
  }

  const statusMeta = resolveStatusMeta(labels);
  const maxFunnel = data ? Math.max(1, ...data.funnel.map((f) => f.count)) : 1;

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
        <div className="flex items-center gap-2.5">
          <div className="flex rounded-xl bg-[#EBF0ED] p-[3px]">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[13px] font-bold transition-colors",
                  days === p
                    ? "bg-white text-ink shadow-[0_1px_2px_rgba(10,20,16,.08)]"
                    : "text-slate-500 hover:text-ink",
                )}
              >
                {p}d
              </button>
            ))}
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
            <StatCard label="Leads no funil" value={data.totals.leads} />
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
              hint={`últimos ${data.days} dias`}
              dark
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label="Mensagens recebidas" value={data.totals.inbound} hint={`últimos ${data.days} dias`} />
            <StatCard label="Mensagens enviadas" value={data.totals.outbound} hint={`últimos ${data.days} dias`} />
            <StatCard
              label="Novos leads"
              value={data.newLeadsPerDay.reduce((s, p) => s + p.count, 0)}
              hint={`últimos ${data.days} dias`}
            />
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
            <CardHeader title="Funil" subtitle={`Distribuição por etapa · ${data.days} dias`} />
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
              <CardHeader title="Por campanha" subtitle={`Envios · ${data.days} dias`} />
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
              subtitle={`Conversas encerradas · ${data.days} dias`}
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
