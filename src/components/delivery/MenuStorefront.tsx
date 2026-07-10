"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
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
  function scrollToCat(idx: number) {
    document.getElementById(`cat-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <div className="pb-24">
      {!open && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          Loja fechada no momento. Você pode ver o cardápio, mas o pedido só é aceito no horário de funcionamento.
        </div>
      )}

      {menu.categories.length === 0 && (
        <p className="rounded-2xl border border-line bg-card px-4 py-12 text-center text-sm text-slate-500">
          Nenhum item no cardápio ainda.
        </p>
      )}

      {/* Navegação de categorias (fixa ao rolar) */}
      {menu.categories.length > 1 && (
        <nav className="sticky top-0 z-10 -mx-4 mb-4 flex gap-2 overflow-x-auto border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {menu.categories.map((cat, idx) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => scrollToCat(idx)}
              className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand-400 hover:text-brand-600"
            >
              {cat.name}
            </button>
          ))}
        </nav>
      )}

      <div className="space-y-7">
        {menu.categories.map((cat, idx) => (
          <section key={cat.name} id={`cat-${idx}`} className="scroll-mt-20">
            <h2 className="mb-3 font-display text-lg font-bold tracking-[-0.01em] text-ink">{cat.name}</h2>
            <div className="space-y-3">
              {cat.items.map((it) => (
                <div
                  key={it.id}
                  className={`flex gap-3 rounded-2xl border border-line bg-card p-3 transition-shadow hover:shadow-sm ${
                    !it.available ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="font-semibold leading-snug text-ink">{it.name}</p>
                    {it.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{it.description}</p>
                    )}
                    <p className="mt-auto pt-2 text-sm font-bold text-ink">{formatCentsBRL(it.priceCents)}</p>
                  </div>

                  <div className="relative shrink-0">
                    {it.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.photoUrl} alt={it.name} className="h-24 w-24 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-inset text-2xl font-bold text-slate-300 dark:text-slate-600">
                        {it.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    {!it.available ? (
                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 shadow-sm dark:bg-rose-500/20 dark:text-rose-300">
                        Esgotado
                      </span>
                    ) : cart[it.id] ? (
                      <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-raised px-1 py-1 shadow-md">
                        <button
                          type="button"
                          onClick={() => changeQty(it.id, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-inset"
                          aria-label="Remover um"
                        >
                          −
                        </button>
                        <span className="min-w-5 text-center text-sm font-bold text-ink">{cart[it.id]}</span>
                        <button
                          type="button"
                          onClick={() => changeQty(it.id, 1)}
                          disabled={!open}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white disabled:opacity-40"
                          aria-label="Adicionar um"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => changeQty(it.id, 1)}
                        disabled={!open}
                        className="absolute -bottom-2 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-lg font-bold text-white shadow-md disabled:opacity-40"
                        aria-label={`Adicionar ${it.name}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Barra de carrinho fixa */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-4 pb-4">
          <button
            type="button"
            onClick={() => setView("cart")}
            className="flex w-full items-center justify-between rounded-2xl bg-brand-500 px-4 py-3.5 text-white shadow-xl shadow-brand-500/25 transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="relative">
                <ShoppingBag size={20} />
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-brand-600">
                  {cartCount}
                </span>
              </span>
              Ver carrinho
            </span>
            <span className="text-base font-bold">{formatCentsBRL(totals.totalCents)}</span>
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
