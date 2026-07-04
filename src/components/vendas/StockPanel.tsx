"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, Plus, SlidersHorizontal, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL } from "@/lib/money";

interface StockItem {
  id: string;
  name: string;
  sku: string | null;
  stockQty: number;
  minStock: number;
  costCents: number | null;
  low: boolean;
}

interface Movement {
  id: string;
  kind: "ENTRADA" | "SAIDA" | "AJUSTE";
  delta: number;
  balanceAfter: number;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<Movement["kind"], string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  AJUSTE: "Ajuste",
};

// Client component: renderiza no fuso local do usuário (o ISO vem em UTC).
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Aba Estoque (dono/canSettings). Lista os produtos com controle ligado, destaca os
 * que estão no/abaixo do mínimo, e permite entrada (+), ajuste (saldo real) e ver os
 * movimentos. Fala com /api/vendas/stock. O saldo NUNCA é editado direto — só por
 * movimento (entrada/ajuste) ou pela baixa automática ao fechar comanda.
 */
export function StockPanel() {
  const [items, setItems] = useState<StockItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/stock", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items as StockItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lowCount = items?.filter((i) => i.low).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Estoque"
        subtitle="Controle dos produtos com estoque ligado. A venda dá baixa automática ao fechar a comanda."
      />

      <div className="space-y-4 px-5 py-4">
        {items === null ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Carregando…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nenhum produto com controle de estoque. Ligue “Controlar estoque” num produto no Catálogo.
          </p>
        ) : (
          <>
            {lowCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertTriangle size={16} className="shrink-0" />
                {lowCount} {lowCount === 1 ? "produto" : "produtos"} no/abaixo do mínimo.
              </div>
            )}
            <ul className="space-y-1.5">
              {items.map((it) => (
                <StockRow key={it.id} item={it} onChanged={load} />
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function StockRow({ item, onChanged }: { item: StockItem; onChanged: () => Promise<void> }) {
  const [action, setAction] = useState<null | "entry" | "adjust" | "movements">(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [newQty, setNewQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);

  function toggle(next: "entry" | "adjust" | "movements") {
    setError(null);
    setAction((cur) => (cur === next ? null : next));
    if (next === "movements") void loadMovements();
  }

  const loadMovements = useCallback(async () => {
    setMovements(null);
    try {
      const res = await fetch(`/api/vendas/stock/${item.id}/movements`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setMovements(data.movements as Movement[]);
    } catch {
      setMovements([]);
    }
  }, [item.id]);

  async function submitEntry() {
    setError(null);
    const q = Math.floor(Number(qty));
    if (!Number.isInteger(q) || q <= 0) return setError("Quantidade inválida.");
    setBusy(true);
    try {
      const res = await fetch(`/api/vendas/stock/${item.id}/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: q, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao dar entrada.");
      setQty("");
      setReason("");
      setAction(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao dar entrada.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust() {
    setError(null);
    const q = Math.floor(Number(newQty));
    if (!Number.isInteger(q) || q < 0) return setError("Saldo inválido.");
    setBusy(true);
    try {
      const res = await fetch(`/api/vendas/stock/${item.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newQty: q, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao ajustar.");
      setNewQty("");
      setReason("");
      setAction(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao ajustar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line-default bg-card px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {item.name}
            {item.sku && <span className="ml-2 text-xs text-slate-400">{item.sku}</span>}
          </p>
          <p className="text-xs text-slate-400">
            Saldo:{" "}
            <span className={`font-semibold ${item.low ? "text-danger" : "text-ink"}`}>{item.stockQty}</span>
            <span className="text-slate-400"> • mín. {item.minStock}</span>
            {item.costCents != null && <span className="text-slate-400"> • custo {formatCentsBRL(item.costCents)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => toggle("entry")}>
            <Plus size={14} /> Entrada
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toggle("adjust")}>
            <SlidersHorizontal size={14} /> Ajustar
          </Button>
          <button
            type="button"
            onClick={() => toggle("movements")}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600"
          >
            {action === "movements" ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Movimentos
          </button>
        </div>
      </div>

      {action === "entry" && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line-default bg-inset px-3 py-2.5 sm:flex-row sm:items-center">
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="numeric"
            placeholder="Quantidade"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nota (opcional)"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <Button size="sm" onClick={submitEntry} loading={busy}>
            Confirmar
          </Button>
        </div>
      )}

      {action === "adjust" && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line-default bg-inset px-3 py-2.5 sm:flex-row sm:items-center">
          <input
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            inputMode="numeric"
            placeholder="Saldo real"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (ex.: inventário, perda)"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <Button size="sm" onClick={submitAdjust} loading={busy}>
            Confirmar
          </Button>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

      {action === "movements" && (
        <div className="mt-2 rounded-lg border border-line-default bg-inset px-3 py-2">
          {movements === null ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" /> Carregando…
            </div>
          ) : movements.length === 0 ? (
            <p className="text-xs text-slate-400">Sem movimentos ainda.</p>
          ) : (
            <ul className="divide-y divide-line-default">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="text-slate-500">
                    {formatDateTime(m.createdAt)} • {KIND_LABEL[m.kind]}
                    {m.reason && <span className="text-slate-400"> ({m.reason})</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`font-semibold ${m.delta < 0 ? "text-danger" : "text-brand-700"}`}>
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </span>
                    <span className="text-slate-400">→ {m.balanceAfter}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
