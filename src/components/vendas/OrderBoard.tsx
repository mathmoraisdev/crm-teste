"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Minus, Trash2, Search, X, SlidersHorizontal, Printer, ChefHat } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import { printReceipt, printKitchenTickets } from "@/lib/receipt/print-client";
import { OrderCustomFields } from "@/components/vendas/OrderCustomFields";
import { CashSessionBar } from "@/components/vendas/CashSessionBar";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

type Payment = "DINHEIRO" | "PIX" | "CARTAO" | "OUTRO";

interface OrderItem {
  id: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  catalogItemId: string | null;
  customFields: Record<string, unknown> | null;
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
  customFields: Record<string, unknown> | null;
  discountCents: number | null;
  surchargeCents: number | null;
  tipCents: number | null;
  amountTenderedCents: number | null;
  changeCents: number | null;
  tableLabel: string | null;
  items: OrderItem[];
  subtotalCents: number;
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
  const [orderDefs, setOrderDefs] = useState<CustomFieldDefItem[]>([]);
  const [itemDefs, setItemDefs] = useState<CustomFieldDefItem[]>([]);
  const [todayCents, setTodayCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Comanda recém-fechada: some da lista de abertas, então guardamos aqui p/
  // oferecer a impressão do cupom sem forçar impressão automática (o operador
  // escolhe 80/58 e evita imprimir sem querer).
  const [justClosed, setJustClosed] = useState<{ id: string; name: string } | null>(null);

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

  const loadDefs = useCallback(async () => {
    try {
      const [orderRes, itemRes] = await Promise.all([
        fetch("/api/custom-fields?scope=ORDER", { cache: "no-store" }),
        fetch("/api/custom-fields?scope=ORDER_ITEM", { cache: "no-store" }),
      ]);
      const orderData = await orderRes.json().catch(() => ({}));
      const itemData = await itemRes.json().catch(() => ({}));
      if (orderRes.ok) setOrderDefs((orderData.defs as CustomFieldDefItem[]) ?? []);
      if (itemRes.ok) setItemDefs((itemData.defs as CustomFieldDefItem[]) ?? []);
    } catch {
      /* sem defs → seção de campos fica oculta */
    }
  }, []);

  useEffect(() => {
    loadOrders();
    loadCatalog();
    loadToday();
    loadDefs();
  }, [loadOrders, loadCatalog, loadToday, loadDefs]);

  // Pré-vínculo vindo da ficha do cliente (/caixa?leadId=…): abre automaticamente
  // uma comanda ligada àquele lead e limpa o parâmetro (roda uma única vez).
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledRef = useRef(false);
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (!leadId || prefilledRef.current) return;
    prefilledRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/vendas/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        });
        const data = await res.json();
        if (res.ok) {
          await loadOrders();
          setSelectedId(data.order.id as string);
        } else {
          setError(data?.error || "Erro ao abrir comanda do cliente.");
        }
      } catch {
        setError("Erro ao abrir comanda do cliente.");
      } finally {
        router.replace("/caixa"); // tira o leadId da URL (evita reabrir no refresh)
      }
    })();
  }, [searchParams, loadOrders, router]);

  async function refreshAfterAction() {
    await Promise.all([loadOrders(), loadToday()]);
  }

  return (
    <div>
      {/* Barra de estado do turno (abrir/fechar caixa, sangria/suprimento) */}
      <CashSessionBar />

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
                          ? "border-brand-400 bg-brand-500/10"
                          : "border-line-default bg-card hover:border-brand-200"
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
          <p className="mb-3 rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {justClosed && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-success-surface px-3 py-2.5">
            <p className="text-sm font-medium text-success">
              Comanda de {justClosed.name} fechada ✓
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => printReceipt(justClosed.id, 80)}>
                <Printer size={14} /> Imprimir 80mm
              </Button>
              <Button size="sm" variant="secondary" onClick={() => printReceipt(justClosed.id, 58)}>
                58mm
              </Button>
              <button
                type="button"
                onClick={() => setJustClosed(null)}
                className="text-slate-400 hover:text-ink"
                aria-label="Dispensar"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
        {selected ? (
          <OrderPanel
            order={selected}
            catalog={catalog}
            orderDefs={orderDefs}
            itemDefs={itemDefs}
            onChanged={refreshAfterAction}
            onClosed={(id, name) => setJustClosed({ id, name })}
            onError={setError}
          />
        ) : (
          <Card className="flex items-center justify-center px-6 py-16">
            <p className="text-sm text-slate-400">Selecione ou abra uma comanda para começar.</p>
          </Card>
        )}
      </div>
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
  const [customerPhone, setCustomerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadHits, setLeadHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showLeadSearch, setShowLeadSearch] = useState(false);

  async function open(payload: { customerName?: string; leadId?: string; customerPhone?: string }) {
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
      setCustomerPhone("");
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
        <div className="space-y-2">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nome do cliente (avulso)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <div className="flex gap-2">
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                open({ customerName: customerName.trim() || "Sem nome", customerPhone: customerPhone.trim() || undefined })
              }
              placeholder="Telefone (vira lead no CRM)"
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <Button
              size="sm"
              onClick={() =>
                open({ customerName: customerName.trim() || "Sem nome", customerPhone: customerPhone.trim() || undefined })
              }
              loading={saving}
            >
              <Plus size={14} /> Abrir
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            Com telefone, o cliente vira um contato no CRM (se já existir, apenas vincula).
          </p>
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
                      className="flex w-full items-center justify-between rounded-lg border border-line-default bg-card px-3 py-1.5 text-left text-sm hover:border-brand-300"
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
  orderDefs,
  itemDefs,
  onChanged,
  onClosed,
  onError,
}: {
  order: Order;
  catalog: CatalogItem[];
  orderDefs: CustomFieldDefItem[];
  itemDefs: CustomFieldDefItem[];
  onChanged: () => Promise<void>;
  onClosed: (orderId: string, name: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [catQuery, setCatQuery] = useState("");
  const [bipar, setBipar] = useState("");
  const [biparBusy, setBiparBusy] = useState(false);
  const [avulsoName, setAvulsoName] = useState("");
  const [avulsoPrice, setAvulsoPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // PATCH de customFields (comanda ou item). Lança em erro → OrderCustomFields exibe.
  async function saveFields(url: string, patch: Record<string, unknown>) {
    onError(null);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Erro ao salvar campos.");
    await onChanged();
  }

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

  const setQty = (itemId: string, quantity: number) =>
    call(`/api/vendas/orders/${order.id}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });

  // Adicionar do catálogo: se o item já está na comanda, incrementa a linha
  // existente em vez de criar outra (resolve o hack de "repetir linha").
  const addFromCatalog = (id: string) => {
    const existing = order.items.find((i) => i.catalogItemId === id);
    if (existing) return setQty(existing.id, existing.quantity + 1);
    return call(`/api/vendas/orders/${order.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: id, quantity: 1 }),
    });
  };

  // Bipar: resolve o código de barras → item da conta → addFromCatalog (reusa o
  // incremento de linha). Leitor USB "digita" o EAN + Enter num input focado.
  async function scanBarcode() {
    const code = bipar.trim();
    if (!code) return;
    setBiparBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/vendas/catalog/lookup?barcode=${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Código não encontrado.");
      setBipar("");
      await addFromCatalog(data.item.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Código não encontrado.");
    } finally {
      setBiparBusy(false);
    }
  }

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

  // Grava um ajuste financeiro (desconto/taxa/gorjeta/mesa) sem fechar — cai no
  // ramo "sem payment" do PATCH. O total volta recalculado pelo servidor.
  const saveAdjustment = (patch: Record<string, unknown>) =>
    call(`/api/vendas/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

  // Fecha a comanda com o payload de pagamento montado pelo PaymentPanel
  // (tenders + valor recebido + allowPartial). Sucesso: a comanda vira FECHADA e
  // sai da lista de abertas — sinaliza p/ o board oferecer a impressão do cupom.
  async function submitClose(payload: Record<string, unknown>) {
    const ok = await call(`/api/vendas/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (ok) onClosed(order.id, order.customerName ?? "lead");
    return ok;
  }

  // N3: imprime as comandas de produção (um ticket por setor). Roda com a comanda
  // ABERTA (a cozinha prepara antes de fechar). 0 tickets = nenhum item tem setor.
  const [sendingProd, setSendingProd] = useState(false);
  async function sendToProduction() {
    setSendingProd(true);
    onError(null);
    try {
      const n = await printKitchenTickets(order.id);
      if (n === 0) onError("Nenhum item tem setor de produção. Defina o setor no catálogo (ex.: cozinha, bar).");
    } finally {
      setSendingProd(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={order.customerName ?? "Comanda de lead"}
        subtitle="Adicione itens do catálogo ou linhas avulsas. O total é calculado ao vivo."
      />
      <div className="space-y-4 px-5 py-4">
        {/* Campos da comanda (scope=ORDER) */}
        {orderDefs.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <OrderCustomFields
              defs={orderDefs}
              values={order.customFields}
              title="Dados da comanda"
              onSave={(patch) => saveFields(`/api/vendas/orders/${order.id}/fields`, patch)}
            />
          </div>
        )}

        {/* Itens da comanda */}
        {order.items.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum item ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {order.items.map((it) => (
              <li key={it.id} className="rounded-lg border border-line-default bg-card">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-ink">{it.nameSnapshot}</span>
                  <div className="flex items-center gap-3">
                    {/* Stepper de quantidade */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(it.id, it.quantity - 1)}
                        disabled={busy || it.quantity <= 1}
                        className="rounded border border-line-default p-1 text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-30"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums text-ink">{it.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQty(it.id, it.quantity + 1)}
                        disabled={busy}
                        className="rounded border border-line-default p-1 text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-30"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <span className="text-sm text-slate-600">{formatCentsBRL(it.unitPriceCents * it.quantity)}</span>
                    {itemDefs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(it.id)}
                        className={`${
                          expanded.has(it.id) || (it.customFields && Object.keys(it.customFields).length > 0)
                            ? "text-brand-600"
                            : "text-slate-400"
                        } hover:text-brand-600`}
                        aria-label="Campos do item"
                        aria-expanded={expanded.has(it.id)}
                      >
                        <SlidersHorizontal size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeLine(it.id)}
                      disabled={busy}
                      className="text-slate-400 hover:text-danger disabled:opacity-40"
                      aria-label="Remover item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {itemDefs.length > 0 && expanded.has(it.id) && (
                  <div className="border-t border-line-default px-3 py-2">
                    <OrderCustomFields
                      defs={itemDefs}
                      values={it.customFields}
                      onSave={(patch) =>
                        saveFields(`/api/vendas/orders/${order.id}/items/${it.id}/fields`, patch)
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Ajustes financeiros + total ao vivo */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <AdjustmentsEditor order={order} disabled={busy} onSave={saveAdjustment} />

          {/* Desdobramento: só mostra as linhas de ajuste != 0 */}
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span>Subtotal</span>
              <span>{formatCentsBRL(order.subtotalCents)}</span>
            </div>
            {!!order.discountCents && (
              <div className="flex items-center justify-between text-danger">
                <span>Desconto</span>
                <span>− {formatCentsBRL(order.discountCents)}</span>
              </div>
            )}
            {!!order.surchargeCents && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Taxa de serviço</span>
                <span>+ {formatCentsBRL(order.surchargeCents)}</span>
              </div>
            )}
            {!!order.tipCents && (
              <div className="flex items-center justify-between text-slate-500">
                <span>Gorjeta</span>
                <span>+ {formatCentsBRL(order.tipCents)}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-sm font-semibold text-slate-600">Total</span>
            <span className="text-xl font-bold text-ink">{formatCentsBRL(order.totalCents)}</span>
          </div>
        </div>

        {/* Adicionar do catálogo */}
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">Adicionar do catálogo</p>
          <input
            value={bipar}
            onChange={(e) => setBipar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void scanBarcode();
              }
            }}
            disabled={busy || biparBusy}
            placeholder="Bipar código de barras…"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
          />
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
                    className="flex w-full items-center justify-between rounded-lg border border-line-default bg-card px-3 py-1.5 text-left text-sm hover:border-brand-300 disabled:opacity-50"
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

        {/* Produção (N3): envia os itens p/ a(s) impressora(s) de setor */}
        <div className="flex justify-end border-t border-slate-100 pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={sendToProduction}
            loading={sendingProd}
            disabled={order.items.length === 0}
          >
            <ChefHat size={14} /> Enviar para produção
          </Button>
        </div>

        {/* Pagamento + fechamento (multi-meio, troco, parcial) */}
        <PaymentPanel order={order} busy={busy} onSubmit={submitClose} />
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Ajustes financeiros: desconto / taxa de serviço / gorjeta
// ───────────────────────────────────────────────────────────────────────

/** centavos → "12,34" (sem "R$", p/ preencher os inputs de edição). */
function centsToPlain(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type AdjMode = "BRL" | "PCT";

/** Um campo de ajuste: valor em R$ OU %. O % é resolvido em centavos na borda
 * (`baseForPct`) e persistido; ao reler, o campo volta em R$ com o valor resolvido. */
function AdjField({
  label,
  valueCents,
  baseForPct,
  quickPct,
  disabled,
  onApply,
}: {
  label: string;
  valueCents: number | null;
  baseForPct: number; // base p/ converter % → centavos
  quickPct?: number; // atalho (ex.: 10 → taxa de 10%)
  disabled: boolean;
  onApply: (cents: number | null) => void;
}) {
  const [mode, setMode] = useState<AdjMode>("BRL");
  const [raw, setRaw] = useState("");

  // Reflete o valor persistido (após salvar/recarregar), sempre em R$.
  useEffect(() => {
    setRaw(valueCents != null ? centsToPlain(valueCents) : "");
    setMode("BRL");
  }, [valueCents]);

  function pctToCents(text: string): number | null {
    const pct = parseFloat(text.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0) return null;
    return Math.round((baseForPct * pct) / 100);
  }

  function apply() {
    const t = raw.trim();
    if (!t) {
      if (valueCents != null) onApply(null); // limpou o campo → zera o ajuste
      return;
    }
    const cents = mode === "PCT" ? pctToCents(t) : parseBRLToCents(t);
    if (cents == null) return;
    if (cents !== (valueCents ?? 0)) onApply(cents);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-sm text-slate-600">{label}</span>
      <div className="flex flex-1 items-center gap-1">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "BRL" ? "PCT" : "BRL"))}
          disabled={disabled}
          className="w-9 shrink-0 rounded-lg border border-slate-300 py-1.5 text-xs font-semibold text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
          aria-label={`Alternar para ${mode === "BRL" ? "porcentagem" : "reais"}`}
        >
          {mode === "BRL" ? "R$" : "%"}
        </button>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          disabled={disabled}
          placeholder={mode === "BRL" ? "0,00" : "0"}
          inputMode="decimal"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
        />
        {quickPct != null && (
          <button
            type="button"
            onClick={() => onApply(Math.round((baseForPct * quickPct) / 100))}
            disabled={disabled || baseForPct === 0}
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
          >
            {quickPct}%
          </button>
        )}
      </div>
    </div>
  );
}

function AdjustmentsEditor({
  order,
  disabled,
  onSave,
}: {
  order: Order;
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const afterDiscount = Math.max(0, order.subtotalCents - (order.discountCents ?? 0));
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-xs font-semibold text-slate-600">Ajustes</p>
      <AdjField
        label="Desconto"
        valueCents={order.discountCents}
        baseForPct={order.subtotalCents}
        disabled={disabled}
        onApply={(cents) => onSave({ discountCents: cents })}
      />
      <AdjField
        label="Taxa de serviço"
        valueCents={order.surchargeCents}
        baseForPct={afterDiscount}
        quickPct={10}
        disabled={disabled}
        onApply={(cents) => onSave({ surchargeCents: cents })}
      />
      <AdjField
        label="Gorjeta"
        valueCents={order.tipCents}
        baseForPct={afterDiscount}
        disabled={disabled}
        onApply={(cents) => onSave({ tipCents: cents })}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Pagamento: N meios (multi/parcial), valor recebido + troco, fechamento
// ───────────────────────────────────────────────────────────────────────
function PaymentPanel({
  order,
  busy,
  onSubmit,
}: {
  order: Order;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const total = order.totalCents;
  const [lines, setLines] = useState<{ method: Payment; raw: string }[]>([{ method: "DINHEIRO", raw: "" }]);
  const [received, setReceived] = useState("");
  const [confirmPartial, setConfirmPartial] = useState(false);
  // Comissão: profissional creditado (opcional). Só aparece se a conta tem
  // profissional ativo; a comanda ligada a um agendamento já credita sozinha no
  // backend — este seletor é p/ a comanda avulsa (POS) ou p/ corrigir.
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[]>([]);
  const [professionalId, setProfessionalId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/professionals?activeOnly=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setProfessionals((((data.professionals as { id: string; name: string }[]) ?? []).map((p) => ({ id: p.id, name: p.name }))));
      } catch {
        // sem seletor de profissional
      }
    })();
  }, []);

  const parsed = lines.map((l) => ({ method: l.method, amountCents: parseBRLToCents(l.raw) ?? 0 }));
  const typedSum = parsed.reduce((s, t) => s + t.amountCents, 0);
  // Fechamento simples: ninguém digitou valor → 1 tender do 1º método cobre o total.
  const tenders = typedSum === 0 ? [{ method: lines[0].method, amountCents: total }] : parsed.filter((t) => t.amountCents > 0);
  const paid = tenders.reduce((s, t) => s + t.amountCents, 0);
  const saldo = total - paid; // >0 falta (parcial); <0 excedente; 0 integral
  const hasCash = tenders.some((t) => t.method === "DINHEIRO");
  const receivedCents = parseBRLToCents(received);
  // Troco sobre o DEVIDO em dinheiro (total − pago em outros meios), não sobre o
  // total — igual ao servidor (closeOrder). Mantém display == valor gravado.
  const nonCashPaid = tenders.filter((t) => t.method !== "DINHEIRO").reduce((s, t) => s + t.amountCents, 0);
  const cashDue = Math.max(0, total - nonCashPaid);
  const troco = hasCash && receivedCents != null ? Math.max(0, receivedCents - cashDue) : 0;

  const resetConfirm = () => setConfirmPartial(false);
  function updateLine(i: number, patch: Partial<{ method: Payment; raw: string }>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    resetConfirm();
  }
  function addLine() {
    setLines((ls) => [...ls, { method: "PIX", raw: "" }]);
    resetConfirm();
  }
  function removeLineAt(i: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
    resetConfirm();
  }

  async function submit() {
    // Saldo positivo = fechamento parcial → pede uma confirmação explícita.
    if (saldo > 0 && !confirmPartial) {
      setConfirmPartial(true);
      return;
    }
    const payload: Record<string, unknown> = { tenders, allowPartial: saldo > 0 };
    if (receivedCents != null) payload.amountTenderedCents = receivedCents;
    if (professionalId) payload.professionalId = professionalId;
    const ok = await onSubmit(payload);
    if (ok) {
      setLines([{ method: "DINHEIRO", raw: "" }]);
      setReceived("");
      setConfirmPartial(false);
      setProfessionalId("");
    }
  }

  const disabled = busy || order.items.length === 0;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      {/* Profissional creditado (comissão) — só quando a conta tem profissional ativo */}
      {professionals.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-slate-600">Profissional</span>
          <select
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            disabled={disabled}
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
          >
            <option value="">Automático (do agendamento)</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      <p className="text-xs font-semibold text-slate-600">Pagamento</p>

      {/* Linhas de pagamento (método + valor) */}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={l.method}
              onChange={(e) => updateLine(i, { method: e.target.value as Payment })}
              disabled={disabled}
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
            >
              {PAYMENTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={l.raw}
              onChange={(e) => updateLine(i, { raw: e.target.value })}
              disabled={disabled}
              inputMode="decimal"
              placeholder={lines.length === 1 ? `${formatCentsBRL(total)} (total)` : "Valor (R$)"}
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
            />
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => removeLineAt(i)}
                disabled={disabled}
                className="text-slate-400 hover:text-danger disabled:opacity-40"
                aria-label="Remover meio de pagamento"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          disabled={disabled}
          className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
        >
          + adicionar meio
        </button>
      </div>

      {/* Valor recebido (dinheiro) → troco ao vivo */}
      {hasCash && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-slate-600">Valor recebido</span>
          <input
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            disabled={disabled}
            inputMode="decimal"
            placeholder="R$ recebido em dinheiro"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
          />
        </div>
      )}

      {/* Saldo / troco */}
      <div className="space-y-1 text-sm">
        {troco > 0 && (
          <div className="flex items-center justify-between font-semibold text-success">
            <span>Troco</span>
            <span>{formatCentsBRL(troco)}</span>
          </div>
        )}
        {saldo > 0 ? (
          <div className="flex items-center justify-between font-medium text-warning">
            <span>Falta</span>
            <span>{formatCentsBRL(saldo)}</span>
          </div>
        ) : saldo < 0 ? (
          <div className="flex items-center justify-between font-medium text-warning">
            <span>Excedente</span>
            <span>{formatCentsBRL(-saldo)}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-slate-400">
            <span>Saldo</span>
            <span>pago integral</span>
          </div>
        )}
      </div>

      {/* Nudge: soma dos meios acima do total geralmente é o recebido digitado na
          linha errada. O troco em dinheiro vai no campo "Valor recebido", não na
          linha do meio (senão a receita registrada infla). */}
      {saldo < 0 && (
        <p className="rounded-lg bg-warning-surface px-3 py-2 text-xs text-warning">
          Os meios somam mais que o total. Se for <strong>troco em dinheiro</strong>, deixe a linha
          com o valor devido e informe o total recebido em <strong>“Valor recebido”</strong>.
        </p>
      )}

      {confirmPartial && saldo > 0 && (
        <p className="rounded-lg bg-warning-surface px-3 py-2 text-xs text-warning">
          Pagamento menor que o total (falta {formatCentsBRL(saldo)}). Clique de novo para
          <strong> fechar parcial</strong> — a comanda fecha com saldo em aberto.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={busy} disabled={disabled}>
          {saldo > 0 ? (confirmPartial ? "Confirmar parcial" : "Fechar parcial…") : "Fechar comanda"}
        </Button>
      </div>
    </div>
  );
}
