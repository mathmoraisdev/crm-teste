"use client";

import { useState } from "react";
import type { PublicMenuDTO } from "@/server/services/menu.service";
import type { DeliverySettingsDTO } from "@/server/services/delivery-settings.service";
import type { DeliveryZoneDTO } from "@/server/services/delivery-zone.service";
import { formatCentsBRL } from "@/lib/money";

/**
 * Vitrine do cardápio online. Rendera o cardápio agrupado por categoria e
 * orquestra carrinho + checkout (Fase 5). Quando a loja está fechada, mostra o
 * cardápio mas desabilita o checkout com aviso.
 *
 * (Versão inicial: vitrine read-only + carrinho simples. Checkout completo
 * chega na Task 5.2.)
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

  function add(id: string) {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  }
  function remove(id: string) {
    setCart((c) => {
      const n = (c[id] ?? 0) - 1;
      const next = { ...c };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const subtotalCents = items.reduce((s, it) => s + it.priceCents * (cart[it.id] ?? 0), 0);

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
                  <img
                    src={it.photoUrl}
                    alt={it.name}
                    className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg text-slate-400 dark:bg-slate-800">
                    {it.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{it.name}</p>
                  {it.description && (
                    <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>
                  )}
                  <p className="mt-0.5 text-sm font-medium text-brand-600">
                    {formatCentsBRL(it.priceCents)}
                  </p>
                </div>
                {it.available ? (
                  <div className="flex items-center gap-2">
                    {cart[it.id] ? (
                      <>
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-ink dark:border-slate-600"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-sm font-semibold text-ink">
                          {cart[it.id]}
                        </span>
                        <button
                          type="button"
                          onClick={() => add(it.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white"
                        >
                          +
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(it.id)}
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

      {/* Barra de carrinho (placeholder do checkout completo da Fase 5) */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md px-4 pb-4">
          <div className="flex items-center justify-between rounded-xl bg-brand-500 px-4 py-3 text-white shadow-lg">
            <span className="text-sm font-medium">
              {cartCount} {cartCount === 1 ? "item" : "itens"}
            </span>
            <span className="text-sm font-semibold">{formatCentsBRL(subtotalCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
