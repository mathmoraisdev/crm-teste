"use client";

import { useState } from "react";
import type { PublicMenuDTO } from "@/server/services/menu.service";
import type { DeliverySettingsDTO } from "@/server/services/delivery-settings.service";
import type { DeliveryZoneDTO } from "@/server/services/delivery-zone.service";
import { formatCentsBRL } from "@/lib/money";
import { computeCartTotals, type FulfillMode } from "@/lib/delivery/cart";
import { CartSheet } from "./CartSheet";
import { CheckoutForm, type CheckoutResult } from "./CheckoutForm";

type View = "menu" | "cart" | "checkout" | "pix";

/**
 * Orquestra a vitrine do cardápio online: lista por categoria, carrinho
 * (CartSheet), checkout (CheckoutForm) e o resultado Pix (quando pagamento
 * online). Loja fechada → cardápio visível, checkout desabilitado com aviso.
 */
export function MenuStorefront({
  slug,
  menu,
  settings,
  zones,
  open,
}: {
  slug: string;
  menu: PublicMenuDTO;
  settings: DeliverySettingsDTO;
  zones: DeliveryZoneDTO[];
  open: boolean;
}) {
  const items = menu.categories.flatMap((c) => c.items);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>("menu");
  const [pixResult, setPixResult] = useState<CheckoutResult | null>(null);
  const [lastOrderUrl, setLastOrderUrl] = useState<string | null>(null);

  // Modo/zona mantidos entre cart e checkout (default = primeira modalidade disponível).
  const defaultMode: FulfillMode = settings.deliveryEnabled ? "DELIVERY" : "RETIRADA";
  const [mode, setMode] = useState<FulfillMode>(defaultMode);
  const [zoneId, setZoneId] = useState("");

  function changeQty(id: string, delta: number) {
    setCart((c) => {
      const n = (c[id] ?? 0) + delta;
      const next = { ...c };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }
  function clearCart() {
    setCart({});
    setView("menu");
  }

  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const lines = items.filter((i) => cart[i.id] > 0).map((i) => ({ id: i.id, priceCents: i.priceCents, qty: cart[i.id] }));
  const selectedZone = zones.find((z) => z.id === zoneId) ?? null;
  const totals = computeCartTotals(lines, {
    mode,
    feeCents: mode === "DELIVERY" ? (selectedZone?.feeCents ?? 0) : 0,
  });

  function handleSuccess(res: CheckoutResult) {
    setPixResult(res);
    setLastOrderUrl(`/cardapio/${slug}/pedido/${res.orderId}`);
    setView(res.payment === "online" ? "pix" : "menu");
    if (res.payment === "on_delivery") {
      // Pagar na entrega → vai direto ao acompanhamento.
      window.location.href = `/cardapio/${slug}/pedido/${res.orderId}`;
    }
  }

  // Tela Pix (pagamento online criado).
  if (view === "pix" && pixResult?.pix) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-card p-4 text-center">
          <h2 className="font-display text-lg font-bold text-ink">Pague com Pix</h2>
          <p className="mt-1 text-sm text-slate-500">
            Escaneie o QR code ou copie o código abaixo. Seu pedido é confirmado automaticamente após o pagamento.
          </p>
          {pixResult.pix.qrBase64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${pixResult.pix.qrBase64}`}
              alt="QR Code Pix"
              className="mx-auto mt-3 h-48 w-48"
            />
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={pixResult.pix.copiaECola}
              className="w-full rounded-lg border border-slate-300 bg-inset px-3 py-2 text-xs text-ink dark:border-slate-700"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(pixResult.pix!.copiaECola).catch(() => {});
              }}
              className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white"
            >
              Copiar
            </button>
          </div>
          {lastOrderUrl && (
            <a href={lastOrderUrl} className="mt-4 inline-block text-sm text-brand-600 underline">
              Acompanhar meu pedido →
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {!open && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          Loja fechada no momento. Você pode ver o cardápio, mas o pedido só é aceito no horário de funcionamento.
        </div>
      )}

      {menu.categories.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-card px-4 py-10 text-center text-sm text-slate-500">
          Nenhum item no cardápio ainda.
        </p>
      )}

      {menu.categories.map((cat) => (
        <section key={cat.name}>
          <h2 className="mb-2 font-display text-base font-bold text-ink">{cat.name}</h2>
          <div className="space-y-2">
            {cat.items.map((it) => (
              <div
                key={it.id}
                className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-card px-3 py-3 dark:border-slate-700 ${
                  !it.available ? "opacity-60" : ""
                }`}
              >
                {it.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.photoUrl} alt={it.name} className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg text-slate-400 dark:bg-slate-800">
                    {it.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{it.name}</p>
                  {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}
                  <p className="mt-0.5 text-sm font-medium text-brand-600">{formatCentsBRL(it.priceCents)}</p>
                </div>
                {it.available ? (
                  <div className="flex items-center gap-2">
                    {cart[it.id] ? (
                      <>
                        <button
                          type="button"
                          onClick={() => changeQty(it.id, -1)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-ink dark:border-slate-600"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-sm font-semibold text-ink">{cart[it.id]}</span>
                        <button
                          type="button"
                          onClick={() => changeQty(it.id, 1)}
                          disabled={!open}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white disabled:opacity-40"
                        >
                          +
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => changeQty(it.id, 1)}
                        disabled={!open}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white disabled:opacity-40"
                      >
                        +
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                    Esgotado
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Barra de carrinho fixa */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md px-4 pb-4">
          <button
            type="button"
            onClick={() => setView("cart")}
            className="flex w-full items-center justify-between rounded-xl bg-brand-500 px-4 py-3 text-white shadow-lg"
          >
            <span className="text-sm font-medium">
              {cartCount} {cartCount === 1 ? "item" : "itens"} · Ver carrinho
            </span>
            <span className="text-sm font-semibold">{formatCentsBRL(totals.totalCents)}</span>
          </button>
        </div>
      )}

      {view === "cart" && (
        <CartSheet
          items={items}
          cart={cart}
          settings={settings}
          zones={zones}
          mode={mode}
          zoneId={zoneId}
          onClose={() => setView("menu")}
          onCheckout={() => setView("checkout")}
          onChangeQty={changeQty}
          onClear={clearCart}
        />
      )}

      {view === "checkout" && (
        <CheckoutForm
          slug={slug}
          items={items}
          cart={cart}
          settings={settings}
          zones={zones}
          onClose={() => setView("cart")}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
