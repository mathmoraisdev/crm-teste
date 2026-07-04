"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Search, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";

type Payment = "DINHEIRO" | "PIX" | "CARTAO" | "OUTRO";

interface OrderItem {
  id: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  catalogItemId: string | null;
}
interface Order {
  id: string;
  status: "ABERTA" | "FECHADA";
  leadId: string | null;
  customerName: string | null;
  payment: Payment | null;
  note: string | null;
  createdAt: string;
  closedAt: string | null;
  items: OrderItem[];
  totalCents: number;
}
interface CatalogItem { id: string; kind: "SERVICO" | "PRODUTO"; name: string; priceCents: number; active: boolean; }
interface LeadHit { id: string; name: string; phone: string; }

const PAYMENTS: { value: Payment; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "Pix" },
  { value: "CARTAO", label: "Cartão" },
  { value: "OUTRO", label: "Outro" },
];

export function OrderBoard() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [todayCents, setTodayCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = orders?.find((o) => o.id === selectedId) ?? null;

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/orders", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        const list = data.orders as Order[];
        setOrders(list);
        setSelectedId((cur) => (cur && list.some((o) => o.id === cur) ? cur : list[0]?.id ?? null));
      }
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/catalog", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setCatalog((data.items as CatalogItem[]).filter((i) => i.active));
    } catch {
      /* ignore */
    }
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/reports?period=hoje", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTodayCents(data?.summary?.totalCents ?? null);
    } catch {
      /* relatório ainda pode não existir — footer fica oculto */
    }
  }, []);

  useEffect(() => {
    loadOrders();
    loadCatalog();
    loadToday();
  }, [loadOrders, loadCatalog, loadToday]);

  async function refreshAfterAction() {
    await Promise.all([loadOrders(), loadToday()]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ── Coluna: comandas abertas ─────────────────────────────────── */}
      <div className="space-y-4">
        <NewOrderCard onOpened={async (id) => { await loadOrders(); setSelectedId(id); }} onError={setError} />
        <Card>
          <CardHeader title="Comandas abertas" subtitle={orders ? `${orders.length} em aberto` : undefined} />
          <div className="px-3 py-3">
            {orders === null ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Carregando…
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma comanda aberta.</p>
            ) : (
              <ul className="space-y-1.5">
                {orders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(o.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        o.id === selectedId
                          ? "border-brand-300 bg-brand-50"
                          : "border-slate-200 bg-white hover:border-brand-200"
                      }`}
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-ink">
                        {o.customerName ?? "Lead"}
                      </span>
                      <span className="text-sm text-slate-500">{formatCentsBRL(o.totalCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        {todayCents !== null && (
          <Card className="px-4 py-3">
            <p className="text-xs text-slate-500">Faturamento de hoje</p>
            <p className="text-lg font-bold text-ink">{formatCentsBRL(todayCents)}</p>
          </Card>
        )}
      </div>

      {/* ── Painel: comanda selecionada ──────────────────────────────── */}
      <div>
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#C0392B]">{error}</p>
        )}
        {selected ? (
          <OrderPanel
            order={selected}
            catalog={catalog}
            onChanged={refreshAfterAction}
            onError={setError}
          />
        ) : (
          <Card className="flex items-center justify-center px-6 py-16">
            <p className="text-sm text-slate-400">Selecione ou abra uma comanda para começar.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Nova comanda: avulsa (nome) ou ligada a um lead (busca)
// ───────────────────────────────────────────────────────────────────────
function NewOrderCard({
  onOpened,
  onError,
}: {
  onOpened: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadHits, setLeadHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showLeadSearch, setShowLeadSearch] = useState(false);

  async function open(payload: { customerName?: string; leadId?: string }) {
    setSaving(true);
    onError(null);
    try {
      const res = await fetch("/api/vendas/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao abrir comanda.");
      setCustomerName("");
      setLeadQuery("");
      setLeadHits([]);
      setShowLeadSearch(false);
      onOpened(data.order.id as string);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao abrir comanda.");
    } finally {
      setSaving(false);
    }
  }

  async function searchLeads() {
    if (!leadQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/leads?q=${encodeURIComponent(leadQuery.trim())}&take=8`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setLeadHits((data.items as LeadHit[]) ?? []);
    } catch {
      /* ignore */
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Nova comanda" />
      <div className="space-y-3 px-4 py-4">
        <div className="flex gap-2">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && customerName.trim() && open({ customerName: customerName.trim() })}
            placeholder="Nome do cliente (avulso)"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <Button
            size="sm"
            onClick={() => open({ customerName: customerName.trim() || "Sem nome" })}
            loading={saving}
          >
            <Plus size={14} /> Abrir
          </Button>
        </div>

        {showLeadSearch ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600">Buscar lead do CRM</p>
              <button type="button" onClick={() => setShowLeadSearch(false)} className="text-slate-400 hover:text-ink">
                <X size={14} />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchLeads()}
                placeholder="Nome ou telefone"
                className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <Button size="sm" variant="secondary" onClick={searchLeads} loading={searching}>
                <Search size={14} />
              </Button>
            </div>
            {leadHits.length > 0 && (
              <ul className="space-y-1">
                {leadHits.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => open({ leadId: l.id })}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-brand-300"
                    >
                      <span className="truncate font-medium text-ink">{l.name}</span>
                      <span className="text-xs text-slate-400">{l.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowLeadSearch(true)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            ou ligar a um lead do CRM
          </button>
        )}
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Painel da comanda selecionada
// ───────────────────────────────────────────────────────────────────────
function OrderPanel({
  order,
  catalog,
  onChanged,
  onError,
}: {
  order: Order;
  catalog: CatalogItem[];
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [catQuery, setCatQuery] = useState("");
  const [avulsoName, setAvulsoName] = useState("");
  const [avulsoPrice, setAvulsoPrice] = useState("");
  const [payment, setPayment] = useState<Payment>("DINHEIRO");
  const [busy, setBusy] = useState(false);

  const filtered = catQuery.trim()
    ? catalog.filter((c) => c.name.toLowerCase().includes(catQuery.trim().toLowerCase()))
    : catalog;

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Erro.");
      await onChanged();
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addFromCatalog = (id: string) =>
    call(`/api/vendas/orders/${order.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: id, quantity: 1 }),
    });

  async function addAvulso() {
    const cents = parseBRLToCents(avulsoPrice);
    if (!avulsoName.trim()) return onError("Informe o item.");
    if (cents == null) return onError("Preço inválido.");
    const ok = await call(`/api/vendas/orders/${order.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: avulsoName.trim(), unitPriceCents: cents, quantity: 1 }),
    });
    if (ok) {
      setAvulsoName("");
      setAvulsoPrice("");
    }
  }

  const removeLine = (itemId: string) =>
    call(`/api/vendas/orders/${order.id}/items/${itemId}`, { method: "DELETE" });

  const close = () =>
    call(`/api/vendas/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment }),
    });

  return (
    <Card>
      <CardHeader
        title={order.customerName ?? "Comanda de lead"}
        subtitle="Adicione itens do catálogo ou linhas avulsas. O total é calculado ao vivo."
      />
      <div className="space-y-4 px-5 py-4">
        {/* Itens da comanda */}
        {order.items.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum item ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {order.items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm text-ink">
                  {it.quantity > 1 && <span className="text-slate-400">{it.quantity}× </span>}
                  {it.nameSnapshot}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">{formatCentsBRL(it.unitPriceCents * it.quantity)}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(it.id)}
                    disabled={busy}
                    className="text-slate-400 hover:text-[#C0392B] disabled:opacity-40"
                    aria-label="Remover item"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Total ao vivo */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm font-semibold text-slate-600">Total</span>
          <span className="text-xl font-bold text-ink">{formatCentsBRL(order.totalCents)}</span>
        </div>

        {/* Adicionar do catálogo */}
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">Adicionar do catálogo</p>
          <input
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder="Buscar item…"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          {catalog.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhum item ativo no catálogo.</p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => addFromCatalog(c.id)}
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-brand-300 disabled:opacity-50"
                  >
                    <span className="truncate text-ink">{c.name}</span>
                    <span className="text-xs text-slate-400">{formatCentsBRL(c.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Linha avulsa */}
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">Linha avulsa</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={avulsoName}
              onChange={(e) => setAvulsoName(e.target.value)}
              placeholder="Descrição (ex.: Gorjeta)"
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <input
              value={avulsoPrice}
              onChange={(e) => setAvulsoPrice(e.target.value)}
              placeholder="Preço (R$)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
            />
            <Button size="sm" variant="secondary" onClick={addAvulso} disabled={busy}>
              <Plus size={14} /> Adicionar
            </Button>
          </div>
        </div>

        {/* Fechar */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-end">
          <select
            value={payment}
            onChange={(e) => setPayment(e.target.value as Payment)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {PAYMENTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Button onClick={close} loading={busy} disabled={order.items.length === 0}>
            Fechar comanda
          </Button>
        </div>
      </div>
    </Card>
  );
}
