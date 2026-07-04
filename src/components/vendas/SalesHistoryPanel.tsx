"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { formatCentsBRL } from "@/lib/money";
import { PAYMENT_LABEL, PAYMENT_TONE, type Payment } from "./payment-labels";

type Period = "hoje" | "7d" | "mes" | "custom";

interface Row {
  id: string;
  closedAt: string;
  customerName: string | null;
  leadId: string | null;
  operatorName: string;
  payment: Payment | null;
  totalCents: number;
}
interface HistoryResponse {
  items: Row[];
  total: number;
  operators: { id: string; name: string }[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "mes", label: "Mês" },
  { value: "custom", label: "Período" },
];

const TAKE = 50;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function SalesHistoryPanel() {
  const [period, setPeriod] = useState<Period>("mes");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // debounce da busca por nome
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildQuery = useCallback(
    (skip: number) => {
      const sp = new URLSearchParams();
      if (period === "custom") {
        if (from) sp.set("from", new Date(`${from}T00:00:00-03:00`).toISOString());
        if (to) sp.set("to", new Date(`${to}T23:59:59-03:00`).toISOString());
      } else {
        sp.set("period", period);
      }
      if (operatorId) sp.set("operatorId", operatorId);
      if (qDebounced.trim()) sp.set("q", qDebounced.trim());
      sp.set("skip", String(skip));
      sp.set("take", String(TAKE));
      return sp.toString();
    },
    [period, from, to, operatorId, qDebounced],
  );

  // guarda a requisição mais recente para evitar corrida entre respostas
  const reqRef = useRef(0);

  const load = useCallback(
    async (skip: number, append: boolean) => {
      // no modo custom, só busca quando há ao menos uma data
      if (period === "custom" && !from && !to) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      setLoading(true);
      const reqId = ++reqRef.current;
      try {
        const res = await fetch(`/api/vendas/orders/history?${buildQuery(skip)}`, { cache: "no-store" });
        const d = (await res.json()) as HistoryResponse;
        if (reqId !== reqRef.current) return; // resposta obsoleta
        if (res.ok) {
          setRows((prev) => (append ? [...prev, ...d.items] : d.items));
          setTotal(d.total);
          setOperators(d.operators);
        }
      } catch {
        /* mantém estado anterior */
      } finally {
        if (reqId === reqRef.current) setLoading(false);
      }
    },
    [period, from, to, buildQuery],
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  const canLoadMore = rows.length < total;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
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

        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <span className="text-sm text-slate-400">até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
        )}

        <select
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="">Todos os operadores</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente…"
          className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader
          title="Extrato de vendas"
          subtitle={total > 0 ? `${total} comanda${total === 1 ? "" : "s"} fechada${total === 1 ? "" : "s"}` : undefined}
        />
        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-6 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">Nenhuma comanda fechada no período.</p>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Cliente</Th>
                  <Th>Operador</Th>
                  <Th>Pagamento</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.closedAt)}</Td>
                    <Td className="text-ink">{r.customerName ?? "—"}</Td>
                    <Td className="text-slate-600">{r.operatorName}</Td>
                    <Td>
                      {r.payment ? (
                        <Badge tone={PAYMENT_TONE[r.payment]}>{PAYMENT_LABEL[r.payment]}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right font-medium text-ink">
                      {formatCentsBRL(r.totalCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {canLoadMore && (
              <div className="px-5 py-4">
                <button
                  type="button"
                  onClick={() => load(rows.length, true)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
