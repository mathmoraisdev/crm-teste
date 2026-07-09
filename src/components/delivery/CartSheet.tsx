"use client";

import type { MenuItemDTO } from "@/server/services/menu.service";
import type { DeliverySettingsDTO } from "@/server/services/delivery-settings.service";
import type { DeliveryZoneDTO } from "@/server/services/delivery-zone.service";
import { formatCentsBRL } from "@/lib/money";
import { computeCartTotals, type FulfillMode } from "@/lib/delivery/cart";

/**
 * Sheet do carrinho: lista linhas com stepper de quantidade, subtotal, taxa (se
 * delivery) e total. Botão "Finalizar" abre o checkout.
 */
export function CartSheet({
  items,
  cart,
  settings,
  zones,
  mode,
  zoneId,
  onClose,
  onCheckout,
  onChangeQty,
  onClear,
}: {
  items: MenuItemDTO[];
  cart: Record<string, number>;
  settings: DeliverySettingsDTO;
  zones: DeliveryZoneDTO[];
  mode: FulfillMode;
  zoneId: string;
  onClose: () => void;
  onCheckout: () => void;
  onChangeQty: (id: string, delta: number) => void;
  onClear: () => void;
}) {
  const lines = items.filter((i) => cart[i.id] > 0);
  const selectedZone = zones.find((z) => z.id === zoneId) ?? null;
  const totals = computeCartTotals(
    lines.map((i) => ({ id: i.id, priceCents: i.priceCents, qty: cart[i.id] })),
    { mode, feeCents: mode === "DELIVERY" ? (selectedZone?.feeCents ?? 0) : 0 },
  );

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Seu carrinho</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-ink">
            ✕
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Seu carrinho está vazio.</p>
        ) : (
          <>
            <div className="space-y-2">
              {lines.map((it) => (
                <div key={it.id} className="flex items-center gap-3 rounded-lg border border-line bg-inset px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{it.name}</p>
                    <p className="text-xs text-slate-500">{formatCentsBRL(it.priceCents)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onChangeQty(it.id, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 text-ink dark:border-slate-600"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-semibold text-ink">{cart[it.id]}</span>
                    <button
                      type="button"
                      onClick={() => onChangeQty(it.id, 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
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

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClear}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 dark:border-slate-700"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={onCheckout}
                className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
              >
                Finalizar pedido
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
