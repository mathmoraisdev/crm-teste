"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatCentsBRL } from "@/lib/money";
import { PAYMENT_LABEL, type Payment } from "./payment-labels";
import { SalesHistoryPanel } from "./SalesHistoryPanel";

type Period = "hoje" | "7d" | "mes";
type View = "resumo" | "extrato";

interface Summary { totalCents: number; orderCount: number; avgTicketCents: number; }
interface ReportData {
  summary: Summary;
  byPayment: { payment: Payment; totalCents: number }[];
  topItems: { name: string; quantity: number; totalCents: number }[];
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
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
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
  return (
    <div className="space-y-4">
      {/* Toggle de período */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
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
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Faturamento" value={s ? formatCentsBRL(s.totalCents) : "—"} loading={loading} />
        <StatCard label="Comandas" value={s ? String(s.orderCount) : "—"} loading={loading} />
        <StatCard label="Ticket médio" value={s ? formatCentsBRL(s.avgTicketCents) : "—"} loading={loading} />
      </div>

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
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs text-slate-500">{label}</p>
      {loading ? (
        <Loader2 size={18} className="mt-1 animate-spin text-slate-300" />
      ) : (
        <p className="mt-0.5 text-2xl font-bold text-ink">{value}</p>
      )}
    </Card>
  );
}
