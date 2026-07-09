"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Package, ChefHat, Bike, Home, Copy, Loader2, X } from "lucide-react";
import { formatCentsBRL } from "@/lib/money";
import type { FulfillmentStatus, OrderType } from "@prisma/client";

// Espelha PublicOrderTracking (order-tracking.service). Mantido local para o
// client não importar do servidor.
interface Tracking {
  id: string;
  number: number | null;
  fulfillmentStatus: FulfillmentStatus | null;
  orderType: OrderType | null;
  customerName: string | null;
  totalCents: number;
  paidOnline: boolean;
  pixCopiaECola: string | null;
  createdAt: string;
  note: string | null;
}

const POLL_MS = 10_000;

// Timeline do ciclo de fulfillment. RECUSADO é tratado à parte (estado final).
const STEPS: { status: FulfillmentStatus; label: string; icon: typeof Clock }[] = [
  { status: "PENDENTE", label: "Recebido", icon: Clock },
  { status: "CONFIRMADO", label: "Confirmado", icon: Check },
  { status: "EM_PREPARO", label: "Em preparo", icon: ChefHat },
  { status: "PRONTO", label: "Pronto", icon: Package },
  { status: "SAIU_ENTREGA", label: "Saiu p/ entrega", icon: Bike },
  { status: "ENTREGUE", label: "Entregue", icon: Home },
];

function stepIndex(s: FulfillmentStatus | null): number {
  if (!s) return 0;
  const idx = STEPS.findIndex((st) => st.status === s);
  return idx < 0 ? 0 : idx;
}

function typeLabel(t: OrderType | null): string {
  return t === "DELIVERY" ? "Entrega" : t === "RETIRADA" ? "Retirada" : "Pedido";
}

export function OrderTracker({
  slug,
  orderId,
  initial,
}: {
  slug: string;
  orderId: string;
  initial: Tracking;
}) {
  const [tracking, setTracking] = useState<Tracking>(initial);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/cardapio/${slug}/pedido/${orderId}`, { cache: "no-store" });
        if (active && res.ok) {
          setTracking((await res.json()) as Tracking);
        }
      } catch {
        /* mantém estado anterior */
      }
    };
    // Para de pollar quando chega num estado final.
    const isFinal =
      tracking.fulfillmentStatus === "ENTREGUE" || tracking.fulfillmentStatus === "RECUSADO";
    if (isFinal) return;
    const t = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking.fulfillmentStatus]);

  async function copyPix() {
    if (!tracking.pixCopiaECola) return;
    try {
      await navigator.clipboard.writeText(tracking.pixCopiaECola);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard pode falhar em http; ignora (o texto está visível p/ copiar manual)
    }
  }

  const current = stepIndex(tracking.fulfillmentStatus);
  const isRejected = tracking.fulfillmentStatus === "RECUSADO";
  const doc = tracking.number != null ? `#${tracking.number}` : orderId.slice(0, 8);
  const needsPix = tracking.pixCopiaECola && !tracking.paidOnline;

  return (
    <div className="space-y-4">
      {/* Cabeçalho do pedido */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(10,20,16,.04),0_8px_24px_-16px_rgba(10,20,16,.10)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">Pedido {doc}</p>
            <p className="font-display text-lg font-bold text-ink">
              {tracking.customerName ?? "Cliente"}
            </p>
            <p className="text-sm text-slate-500">{typeLabel(tracking.orderType)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Total</p>
            <p className="font-display text-lg font-bold text-ink">
              {formatCentsBRL(tracking.totalCents)}
            </p>
          </div>
        </div>
        {tracking.note && (
          <p className="mt-3 rounded-lg bg-inset px-3 py-2 text-xs text-slate-600">
            Obs: {tracking.note}
          </p>
        )}
      </div>

      {/* Pix pendente: mostra o copia-e-cola enquanto não pago */}
      {needsPix && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-400">
            Pagamento Pix pendente
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400/80">
            Pague para confirmar seu pedido. Copie o código abaixo e cole no app do seu banco.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-ink dark:bg-inset">
              {tracking.pixCopiaECola}
            </code>
            <button
              onClick={copyPix}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}

      {/* Pago online confirmado */}
      {tracking.paidOnline && (
        <div className="flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
          <Check size={18} className="text-brand-600 dark:text-brand-400" />
          <span className="text-sm font-semibold text-brand-700 dark:text-brand-400">
            Pagamento confirmado
          </span>
        </div>
      )}

      {/* Timeline */}
      {isRejected ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
          <X size={18} className="text-rose-600 dark:text-rose-400" />
          <div>
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">
              Pedido recusado
            </p>
            <p className="text-xs text-rose-600/80 dark:text-rose-400/70">
              O estabelecimento não pôde atender. {tracking.paidOnline ? "O estorno será processado." : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(10,20,16,.04),0_8px_24px_-16px_rgba(10,20,16,.10)]">
          <ol className="space-y-1">
            {STEPS.map((step, i) => {
              const done = i < current;
              const active = i === current;
              const Icon = step.icon;
              return (
                <li key={step.status} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                        done
                          ? "bg-brand-500 text-white"
                          : active
                            ? "bg-brand-100 text-brand-600 ring-2 ring-brand-500/30 dark:bg-brand-500/15 dark:text-brand-400"
                            : "bg-slate-100 text-slate-400 dark:bg-inset"
                      }`}
                    >
                      {done ? <Check size={16} /> : active ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`h-6 w-0.5 ${done ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />
                    )}
                  </div>
                  <span
                    className={`text-sm ${
                      done || active ? "font-semibold text-ink" : "text-slate-400"
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        Atualização automática a cada {POLL_MS / 1000}s.
      </p>
    </div>
  );
}
