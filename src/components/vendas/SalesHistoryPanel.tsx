"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Printer, Ban, RotateCcw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL } from "@/lib/money";
import { printReceipt } from "@/lib/receipt/print-client";
import { PAYMENT_LABEL, PAYMENT_TONE, type Payment } from "./payment-labels";

type Period = "hoje" | "7d" | "mes" | "custom";
type OrderStatus = "ABERTA" | "FECHADA" | "CANCELADA";

interface Row {
  id: string;
  status: OrderStatus;
  closedAt: string;
  customerName: string | null;
  leadId: string | null;
  operatorName: string;
  payment: Payment | null;
  discountCents: number | null;
  surchargeCents: number | null;
  totalCents: number;
  canceledReason: string | null;
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

export function SalesHistoryPanel({ canEdit = false }: { canEdit?: boolean }) {
  const [period, setPeriod] = useState<Period>("mes");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [q, setQ] = useState("");
  const [showCanceled, setShowCanceled] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Row | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Row | null>(null);

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
      if (showCanceled) sp.set("includeCanceled", "1");
      sp.set("skip", String(skip));
      sp.set("take", String(TAKE));
      return sp.toString();
    },
    [period, from, to, operatorId, qDebounced, showCanceled],
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
      {error && (
        <p className="rounded-lg bg-danger-surface px-3 py-2 text-xs text-danger">{error}</p>
      )}
      {notice && (
        <p className="rounded-lg bg-info-surface px-3 py-2 text-xs text-info">{notice}</p>
      )}
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                period === p.value
                  ? "bg-brand-500 text-white dark:bg-brand-500/15 dark:text-brand-300 dark:ring-1 dark:ring-inset dark:ring-brand-500/40"
                  : "text-slate-600 hover:bg-slate-100"
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
              className="rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <span className="text-sm text-slate-400">até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
        )}

        <select
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          className="rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
          placeholder="Buscar cliente ou item…"
          className="min-w-[180px] flex-1 rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showCanceled}
            onChange={(e) => setShowCanceled(e.target.checked)}
            className="h-4 w-4 rounded border-line-default text-brand-500 focus:ring-brand-100"
          />
          Mostrar estornadas
        </label>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader
          title="Extrato de vendas"
          subtitle={total > 0 ? `${total} comanda${total === 1 ? "" : "s"}` : undefined}
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
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const canceled = r.status === "CANCELADA";
                  return (
                    <tr key={r.id} className={canceled ? "bg-danger-surface/30" : undefined}>
                      <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.closedAt)}</Td>
                      <Td className="text-ink">
                        <span className={canceled ? "text-slate-400 line-through" : undefined}>
                          {r.customerName ?? "—"}
                        </span>
                        {canceled && (
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <Badge tone="red">Estornada</Badge>
                            {r.canceledReason && (
                              <span className="text-xs text-slate-500">{r.canceledReason}</span>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td className="text-slate-600">{r.operatorName}</Td>
                      <Td>
                        {r.payment ? (
                          <Badge tone={PAYMENT_TONE[r.payment]} className={canceled ? "opacity-60" : undefined}>
                            {PAYMENT_LABEL[r.payment]}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td className={`whitespace-nowrap text-right font-medium ${canceled ? "text-slate-400 line-through" : "text-ink"}`}>
                        {formatCentsBRL(r.totalCents)}
                        {!canceled && (!!r.discountCents || !!r.surchargeCents) && (
                          <div className="text-xs font-normal text-slate-400">
                            {!!r.discountCents && <span className="text-danger">− {formatCentsBRL(r.discountCents)}</span>}
                            {!!r.discountCents && !!r.surchargeCents && " · "}
                            {!!r.surchargeCents && <span>+ {formatCentsBRL(r.surchargeCents)}</span>}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => printReceipt(r.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line-default bg-card px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                            title="Reimprimir cupom"
                          >
                            <Printer size={14} /> Reimprimir
                          </button>
                          {canEdit && !canceled && (
                            <>
                              <button
                                type="button"
                                onClick={() => setReopenTarget(r)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line-default bg-card px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                                title="Reabrir para corrigir"
                              >
                                <RotateCcw size={14} /> Reabrir
                              </button>
                              <button
                                type="button"
                                onClick={() => setVoidTarget(r)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line-default bg-card px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-danger hover:text-danger"
                                title="Estornar (anula a venda)"
                              >
                                <Ban size={14} /> Estornar
                              </button>
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            {canLoadMore && (
              <div className="px-5 py-4">
                <button
                  type="button"
                  onClick={() => load(rows.length, true)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-line-default bg-card px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      {voidTarget && (
        <VoidModal
          row={voidTarget}
          onClose={() => setVoidTarget(null)}
          onError={setError}
          onDone={() => {
            setVoidTarget(null);
            setError(null);
            setNotice(null);
            setShowCanceled(true); // revela a linha estornada (riscada) no lugar
            load(0, false);
          }}
        />
      )}

      {reopenTarget && (
        <ReopenModal
          row={reopenTarget}
          onClose={() => setReopenTarget(null)}
          onError={setError}
          onDone={() => {
            setReopenTarget(null);
            setError(null);
            // Reaberta vira ABERTA → sai do extrato; avisa onde encontrá-la.
            setNotice("Comanda reaberta — disponível na aba Comandas para correção.");
            load(0, false);
          }}
        />
      )}
    </div>
  );
}

function VoidModal({
  row,
  onClose,
  onDone,
  onError,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const r = reason.trim();
    if (!r) return onError("Informe o motivo do estorno.");
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/vendas/orders/${row.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: r }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao estornar a comanda.");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao estornar a comanda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Estornar comanda">
      <div className="space-y-4">
        <div className="rounded-lg bg-danger-surface px-3 py-2 text-xs text-danger">
          Isso <strong>anula a venda</strong> ({formatCentsBRL(row.totalCents)}) e <strong>devolve o
          estoque</strong> dos produtos rastreados. A comanda some do faturamento. Ação registrada com
          seu nome — não pode ser desfeita.
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Motivo do estorno</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            rows={3}
            placeholder="ex.: valor lançado errado, cliente desistiu, item trocado…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!reason.trim()}>
            Estornar venda
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReopenModal({
  row,
  onClose,
  onDone,
  onError,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/vendas/orders/${row.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao reabrir a comanda.");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao reabrir a comanda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Reabrir comanda">
      <div className="space-y-4">
        <div className="rounded-lg bg-warning-surface px-3 py-2 text-xs text-warning">
          A comanda volta para <strong>ABERTA</strong> para edição e <strong>devolve o estoque</strong>{" "}
          (será baixado de novo ao fechar). O número do cupom já impresso é liberado — a sequência fica
          com um buraco. Use para <strong>corrigir</strong> uma venda; para anulá-la, prefira estornar.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Reabrir comanda
          </Button>
        </div>
      </div>
    </Modal>
  );
}
