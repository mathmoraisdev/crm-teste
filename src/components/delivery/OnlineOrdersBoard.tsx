"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Check, X, ChevronRight, Bike, Store, MapPin, Phone, Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCentsBRL } from "@/lib/money";
import { printKitchenTickets } from "@/lib/receipt/print-client";
import type { FulfillmentStatus, OrderType } from "@prisma/client";

// Espelha OnlineOrderSummary (fulfillment.service). Mantido local para não
// importar do servidor no client (o tipo vem do JSON da API).
interface OnlineOrder {
  id: string;
  number: number | null;
  fulfillmentStatus: FulfillmentStatus | null;
  orderType: OrderType | null;
  source: string | null;
  customerName: string | null;
  customerPhone: string | null;
  totalCents: number;
  onlinePaidAt: string | null;
  createdAt: string;
  deliveryAddress: unknown;
}

// Colunas do kanban (ordem do fluxo). RECUSADO/ENTREGUE ficam de fora do board
// ativo — são fim de linha; o lojista os vê no histórico do caixa/relatórios.
const COLUMNS: { status: FulfillmentStatus; label: string; tone: "amber" | "blue" | "violet" | "green" | "emerald" }[] = [
  { status: "PENDENTE", label: "Novos", tone: "amber" },
  { status: "CONFIRMADO", label: "Confirmados", tone: "blue" },
  { status: "EM_PREPARO", label: "Em preparo", tone: "violet" },
  { status: "PRONTO", label: "Prontos", tone: "green" },
  { status: "SAIU_ENTREGA", label: "Saiu p/ entrega", tone: "emerald" },
];

const POLL_MS = 15_000;

function statusLabel(s: FulfillmentStatus | null): string {
  switch (s) {
    case "PENDENTE": return "Pendente";
    case "CONFIRMADO": return "Confirmado";
    case "EM_PREPARO": return "Em preparo";
    case "PRONTO": return "Pronto";
    case "SAIU_ENTREGA": return "Saiu p/ entrega";
    case "ENTREGUE": return "Entregue";
    case "RECUSADO": return "Recusado";
    default: return "—";
  }
}

function typeLabel(t: OrderType | null): string {
  return t === "DELIVERY" ? "Entrega" : t === "RETIRADA" ? "Retirada" : "Pedido";
}

interface AddressParts {
  street?: string; number?: string; complement?: string; reference?: string;
}
function addressText(addr: unknown): string | null {
  if (!addr || typeof addr !== "object") return null;
  const a = addr as AddressParts;
  const parts = [a.street, a.number].filter(Boolean);
  const base = parts.join(", ") || null;
  const extra = [a.complement, a.reference].filter(Boolean).join(" — ");
  return [base, extra].filter(Boolean).join(" · ") || null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? ` ${min % 60}min` : ""}`;
}

export function OnlineOrdersBoard() {
  const [orders, setOrders] = useState<OnlineOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const rejectRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delivery/orders", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders as OnlineOrder[]);
        setError(null);
      }
    } catch {
      // mantém o estado anterior; próximo tick tenta de novo
    }
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/delivery/orders", { cache: "no-store" });
        const data = await res.json();
        if (active && res.ok) {
          setOrders(data.orders as OnlineOrder[]);
          setError(null);
        }
      } catch {
        /* mantém estado anterior */
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Foca o textarea ao abrir o modal de recusa.
  useEffect(() => {
    if (rejectingId && rejectRef.current) rejectRef.current.focus();
  }, [rejectingId]);

  async function call(id: string, url: string, opts?: RequestInit): Promise<void> {
    setBusyId(id);
    try {
      const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json" } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Falha na operação");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirm(o: OnlineOrder) {
    try {
      await call(o.id, `/api/delivery/orders/${o.id}/confirm`, { method: "POST" });
      // Imprime as comandas de cozinha (best-effort: não bloqueia o fluxo).
      void printKitchenTickets(o.id).catch(() => {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao confirmar");
    }
  }

  async function handleAdvance(o: OnlineOrder) {
    try {
      await call(o.id, `/api/delivery/orders/${o.id}/advance`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao avançar");
    }
  }

  async function submitReject(o: OnlineOrder) {
    try {
      await call(o.id, `/api/delivery/orders/${o.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      setRejectingId(null);
      setRejectReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao recusar");
    }
  }

  // Estado inicial (primeira carga).
  if (orders === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Carregando pedidos…
      </div>
    );
  }

  const active = orders.filter((o) => o.fulfillmentStatus && o.fulfillmentStatus !== "ENTREGUE" && o.fulfillmentStatus !== "RECUSADO");

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-danger/70 hover:text-danger">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Modal simples de recusa */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRejectingId(null)}>
          <Card className="w-full max-w-md p-5" >
            <div onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-sm font-bold text-ink">Recusar pedido</h3>
              <p className="mt-1 text-xs text-slate-500">
                O cliente será notificado. {orders.find((o) => o.id === rejectingId)?.onlinePaidAt
                  ? "Atenção: pedido pago online — será preciso estornar manualmente."
                  : ""}
              </p>
              <textarea
                ref={rejectRef}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motivo (opcional)"
                rows={3}
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-inset dark:text-ink"
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setRejectingId(null); setRejectReason(""); }}>
                  Cancelar
                </Button>
                <Button variant="danger" size="sm" onClick={() => submitReject(orders.find((o) => o.id === rejectingId)!)} loading={busyId === rejectingId}>
                  Recusar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const colOrders = active.filter((o) => o.fulfillmentStatus === col.status);
          return (
            <div key={col.status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{col.label}</span>
                <Badge tone={col.tone}>{colOrders.length}</Badge>
              </div>
              <div className="flex flex-col gap-3">
                {colOrders.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-slate-400">
                    Nenhum pedido
                  </p>
                ) : (
                  colOrders.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      busy={busyId === o.id}
                      onConfirm={() => handleConfirm(o)}
                      onAdvance={() => handleAdvance(o)}
                      onReject={() => { setRejectingId(o.id); setRejectReason(""); }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {active.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Receipt size={28} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Nenhum pedido online no momento.</p>
          <p className="text-xs text-slate-400">Quando um cliente finalizar a compra no cardápio, ele aparece aqui automaticamente.</p>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  busy,
  onConfirm,
  onAdvance,
  onReject,
}: {
  order: OnlineOrder;
  busy: boolean;
  onConfirm: () => void;
  onAdvance: () => void;
  onReject: () => void;
}) {
  const addr = addressText(order.deliveryAddress);
  const isDelivery = order.orderType === "DELIVERY";
  const paid = !!order.onlinePaidAt;
  const doc = order.number != null ? `#${order.number}` : order.id.slice(0, 8);

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{order.customerName ?? "Cliente"}</p>
          <p className="text-xs text-slate-500">{doc} · {timeAgo(order.createdAt)}</p>
        </div>
        <Badge tone={paid ? "green" : "amber"}>{paid ? "Pago" : "Na entrega"}</Badge>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-slate-600">
        {isDelivery ? <Bike size={13} /> : <Store size={13} />}
        <span>{typeLabel(order.orderType)}</span>
      </div>

      {order.customerPhone && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Phone size={13} />
          <span>{order.customerPhone}</span>
        </div>
      )}

      {addr && (
        <div className="flex items-start gap-1.5 text-xs text-slate-500">
          <MapPin size={13} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{addr}</span>
        </div>
      )}

      <div className="border-t border-line pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Total</span>
          <span className="text-sm font-bold text-ink">{formatCentsBRL(order.totalCents)}</span>
        </div>
      </div>

      {/* Ações por status */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {order.fulfillmentStatus === "PENDENTE" && (
          <>
            <Button size="sm" onClick={onConfirm} loading={busy} className="flex-1">
              <Check size={14} /> Confirmar
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject} disabled={busy} aria-label="Recusar">
              <X size={14} />
            </Button>
          </>
        )}
        {order.fulfillmentStatus && order.fulfillmentStatus !== "PENDENTE" && order.fulfillmentStatus !== "SAIU_ENTREGA" && (
          <Button size="sm" variant="secondary" onClick={onAdvance} loading={busy} className="w-full">
            Avançar <ChevronRight size={14} />
          </Button>
        )}
        {order.fulfillmentStatus === "SAIU_ENTREGA" && (
          <Button size="sm" variant="primary" onClick={onAdvance} loading={busy} className="w-full">
            <Check size={14} /> Finalizar entrega
          </Button>
        )}
      </div>
    </Card>
  );
}
