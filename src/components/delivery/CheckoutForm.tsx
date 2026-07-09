"use client";

import { useState } from "react";
import type { DeliverySettingsDTO } from "@/server/services/delivery-settings.service";
import type { DeliveryZoneDTO } from "@/server/services/delivery-zone.service";
import type { MenuItemDTO } from "@/server/services/menu.service";
import { formatCentsBRL } from "@/lib/money";
import { computeCartTotals, type FulfillMode } from "@/lib/delivery/cart";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-inset dark:text-ink";

export interface CheckoutResult {
  orderId: string;
  payment: "online" | "on_delivery";
  pix?: { copiaECola: string; qrBase64?: string };
}

/**
 * Formulário de checkout: tipo (entrega/retirada), dados do cliente, endereço +
 * zona (taxa), pagamento e observações. Envia p/ `POST /api/cardapio/<slug>/pedido`.
 * O servidor é a autoridade — as validações aqui são só de UX.
 */
export function CheckoutForm({
  slug,
  items,
  cart,
  settings,
  zones,
  onClose,
  onSuccess,
}: {
  slug: string;
  items: MenuItemDTO[];
  cart: Record<string, number>;
  settings: DeliverySettingsDTO;
  zones: DeliveryZoneDTO[];
  onClose: () => void;
  onSuccess: (res: CheckoutResult) => void;
}) {
  const modes: FulfillMode[] = [
    ...(settings.deliveryEnabled ? ["DELIVERY" as const] : []),
    ...(settings.pickupEnabled ? ["RETIRADA" as const] : []),
  ];
  const [mode, setMode] = useState<FulfillMode>(modes[0] ?? "RETIRADA");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");

  const payOnlineAvailable = settings.payOnlineEnabled;
  const payOnDeliveryAvailable = settings.payOnDeliveryEnabled;
  const [payment, setPayment] = useState<"online" | "on_delivery">(
    payOnlineAvailable ? "online" : "on_delivery",
  );

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = items
    .filter((i) => cart[i.id] > 0)
    .map((i) => ({ id: i.id, priceCents: i.priceCents, qty: cart[i.id] }));
  const selectedZone = zones.find((z) => z.id === zoneId) ?? null;
  const totals = computeCartTotals(lines, {
    mode,
    feeCents: mode === "DELIVERY" ? (selectedZone?.feeCents ?? 0) : 0,
  });

  // Pedido mínimo: settings + zona (zona vence se mais restritiva).
  const minOrderCents =
    mode === "DELIVERY" && selectedZone?.minOrderCents != null
      ? Math.max(settings.minOrderCents, selectedZone.minOrderCents)
      : settings.minOrderCents;
  const belowMin = totals.subtotalCents < minOrderCents;

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Informe seu nome.");
    if (phone.replace(/\D/g, "").length < 8) return setError("Telefone inválido (mínimo 8 dígitos).");
    if (mode === "DELIVERY" && !zoneId) return setError("Escolha o bairro.");
    if (mode === "DELIVERY" && !street.trim()) return setError("Informe a rua.");
    if (mode === "DELIVERY" && !number.trim()) return setError("Informe o número.");
    if (belowMin) return setError(`Pedido mínimo de ${formatCentsBRL(minOrderCents)}.`);

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        mode,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        items: lines.map((l) => ({ catalogItemId: l.id, quantity: l.qty })),
        payment,
        note: note.trim() || undefined,
      };
      if (mode === "DELIVERY") {
        body.address = {
          neighborhoodZoneId: zoneId,
          street: street.trim(),
          number: number.trim(),
          complement: complement.trim() || undefined,
          reference: reference.trim() || undefined,
        };
      }
      const res = await fetch(`/api/cardapio/${slug}/pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao registrar o pedido.");
      onSuccess(data as CheckoutResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao registrar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Finalizar pedido</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* Tipo */}
          <div className="flex gap-2">
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  mode === m
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-slate-300 text-ink dark:border-slate-700"
                }`}
              >
                {m === "DELIVERY" ? "Entrega" : "Retirada"}
              </button>
            ))}
          </div>

          {/* Dados do cliente */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Seu nome" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="(11) 99999-9999" inputMode="tel" />
            </div>
          </div>

          {/* Endereço (só delivery) */}
          {mode === "DELIVERY" && (
            <div className="space-y-3 rounded-lg bg-inset p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Bairro / zona</label>
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={inputClass}>
                  <option value="">Selecione…</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} — {formatCentsBRL(z.feeCents)}
                      {z.minOrderCents != null ? ` (mín. ${formatCentsBRL(z.minOrderCents)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Rua</label>
                  <input value={street} onChange={(e) => setStreet(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Nº</label>
                  <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Complemento</label>
                  <input value={complement} onChange={(e) => setComplement(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Referência</label>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
                </div>
              </div>
            </div>
          )}

          {/* Pagamento */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Pagamento</label>
            <div className="flex gap-2">
              {payOnlineAvailable && (
                <button
                  type="button"
                  onClick={() => setPayment("online")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                    payment === "online" ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 text-ink dark:border-slate-700"
                  }`}
                >
                  Pix online
                </button>
              )}
              {payOnDeliveryAvailable && (
                <button
                  type="button"
                  onClick={() => setPayment("on_delivery")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                    payment === "on_delivery" ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 text-ink dark:border-slate-700"
                  }`}
                >
                  Na {mode === "DELIVERY" ? "entrega" : "retirada"}
                </button>
              )}
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Observações (opcional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} placeholder="Ex.: sem cebola, ponto da carne…" />
          </div>

          {/* Resumo */}
          <div className="space-y-1 rounded-lg bg-inset p-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCentsBRL(totals.subtotalCents)}</span>
            </div>
            {mode === "DELIVERY" && (
              <div className="flex justify-between text-slate-600">
                <span>Taxa de entrega</span>
                <span>{selectedZone ? formatCentsBRL(selectedZone.feeCents) : "—"}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-ink">
              <span>Total</span>
              <span>{formatCentsBRL(totals.totalCents)}</span>
            </div>
          </div>

          {belowMin && (
            <p className="rounded-md bg-warning-surface px-3 py-2 text-sm text-warning">
              Pedido mínimo de {formatCentsBRL(minOrderCents)}.
            </p>
          )}
          {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || lines.length === 0}
            className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? "Enviando…" : `Enviar pedido · ${formatCentsBRL(totals.totalCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
