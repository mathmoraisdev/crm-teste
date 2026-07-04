"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatCentsBRL } from "@/lib/money";
import { PAYMENT_LABEL, type Payment } from "./payment-labels";
import { CATEGORY_LABEL } from "./expense-labels";
import { SalesHistoryPanel } from "./SalesHistoryPanel";

type Period = "hoje" | "7d" | "mes";
type View = "resumo" | "extrato";

interface Summary { totalCents: number; orderCount: number; avgTicketCents: number; }
interface OperatorRevenue { operatorId: string; operatorName: string; totalCents: number; orderCount: number; }
interface ReportData {
  summary: Summary;
  byPayment: { payment: Payment; totalCents: number }[];
  byOperator: OperatorRevenue[];
  topItems: { name: string; quantity: number; totalCents: number }[];
  // Só presentes para quem tem canSettings (dono/gerente) — ver rota de reports.
  expensesTotalCents?: number;
  balanceCents?: number;
  expensesByCategory?: { category: string; totalCents: number }[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "mes", label: "Mês" },
];

const VIEWS: { value: View; label: string }[] = [
  { value: "resumo", label: "Resumo" },
  { value: "extrato", label: "Extrato" },
];

export function ReportsPanel() {
  const [view, setView] = useState<View>("resumo");
  const [period, setPeriod] = useState<Period>("hoje");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendas/reports?period=${p}`, { cache: "no-store" });
      const d = await res.json();
      if (res.ok) setData(d as ReportData);
    } catch {
      /* mantém estado anterior */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  return (
    <div className="space-y-4">
      {/* Seletor de visão: Resumo | Extrato */}
      <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setView(v.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              view === v.value ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "extrato" ? (
        <SalesHistoryPanel />
      ) : (
        <ResumoView period={period} setPeriod={setPeriod} data={data} loading={loading} />
      )}
    </div>
  );
}

function ResumoView({
  period,
  setPeriod,
  data,
  loading,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  data: ReportData | null;
  loading: boolean;
}) {
  const s = data?.summary;
  const hasExpenses = data?.expensesTotalCents !== undefined;
  return (
    <div className="space-y-4">
      {/* Toggle de período */}
      <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              period === p.value ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Cards de resumo */}
      {hasExpenses ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Faturamento" value={s ? formatCentsBRL(s.totalCents) : "—"} loading={loading} />
          <StatCard label="Despesas" value={data ? formatCentsBRL(data.expensesTotalCents ?? 0) : "—"} loading={loading} />
          <StatCard
            label="Saldo"
            value={data ? formatCentsBRL(data.balanceCents ?? 0) : "—"}
            loading={loading}
            valueClassName={(data?.balanceCents ?? 0) < 0 ? "text-red-600" : "text-ink"}
          />
          <StatCard label="Ticket médio" value={s ? formatCentsBRL(s.avgTicketCents) : "—"} loading={loading} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Faturamento" value={s ? formatCentsBRL(s.totalCents) : "—"} loading={loading} />
          <StatCard label="Comandas" value={s ? String(s.orderCount) : "—"} loading={loading} />
          <StatCard label="Ticket médio" value={s ? formatCentsBRL(s.avgTicketCents) : "—"} loading={loading} />
        </div>
      )}

      {/* Mais vendidos */}
      <Card>
        <CardHeader title="Mais vendidos" />
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          ) : !data || data.topItems.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma venda no período.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.topItems.map((it) => (
                <li key={it.name} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate text-ink">
                    <span className="text-slate-400">{it.quantity}× </span>
                    {it.name}
                  </span>
                  <span className="text-slate-600">{formatCentsBRL(it.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Por operador (quem lançou) */}
      <Card>
        <CardHeader title="Por operador" subtitle="Faturamento e nº de comandas por quem lançou" />
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          ) : !data || data.byOperator.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma venda no período.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.byOperator.map((op) => (
                <li key={op.operatorId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {op.operatorName}
                    <span className="text-slate-400"> · {op.orderCount} comanda{op.orderCount === 1 ? "" : "s"}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium text-slate-600">{formatCentsBRL(op.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Por forma de pagamento */}
      <Card>
        <CardHeader title="Por forma de pagamento" />
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          ) : !data || data.byPayment.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma venda no período.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.byPayment.map((p) => (
                <li key={p.payment} className="flex items-center justify-between text-sm">
                  <span className="text-ink">{PAYMENT_LABEL[p.payment]}</span>
                  <span className="text-slate-600">{formatCentsBRL(p.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Despesas por categoria (só dono/gerente) */}
      {hasExpenses && (
        <Card>
          <CardHeader title="Despesas por categoria" />
          <div className="px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Carregando…
              </div>
            ) : !data || (data.expensesByCategory?.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma despesa paga no período.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.expensesByCategory!.map((c) => (
                  <li key={c.category} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category}</span>
                    <span className="text-slate-600">{formatCentsBRL(c.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, loading, valueClassName = "text-ink" }: { label: string; value: string; loading: boolean; valueClassName?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs text-slate-500">{label}</p>
      {loading ? (
        <Loader2 size={18} className="mt-1 animate-spin text-slate-300" />
      ) : (
        <p className={`mt-0.5 text-2xl font-bold ${valueClassName}`}>{value}</p>
      )}
    </Card>
  );
}
