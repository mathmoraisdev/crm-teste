"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";

interface OfferItem {
  id: string;
  whatsAppNumberId: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
}

/**
 * CRUD de ofertas de um número (catálogo do "Modo vendas"). Fala com
 * /api/numbers/[id]/offers. Isolado do painel p/ manter o componente pai enxuto.
 */
export function OffersManager({ numberId }: { numberId: string }) {
  const [offers, setOffers] = useState<OfferItem[] | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edição inline de uma oferta existente.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/numbers/${numberId}/offers`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setOffers(data.offers as OfferItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, [numberId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addOffer() {
    setError(null);
    const priceCents = parseBRLToCents(price);
    if (!name.trim()) return setError("Informe o nome da oferta.");
    if (priceCents == null || priceCents < 100) return setError("Preço mínimo é R$1,00.");
    setSaving(true);
    try {
      const res = await fetch(`/api/numbers/${numberId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), priceCents, description: description.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao criar oferta.");
      setName("");
      setPrice("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar oferta.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(o: OfferItem) {
    setEditingId(o.id);
    setEditName(o.name);
    setEditPrice(formatCentsBRL(o.priceCents));
    setEditDescription(o.description ?? "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditError(null);
    const priceCents = parseBRLToCents(editPrice);
    if (!editName.trim()) return setEditError("Informe o nome da oferta.");
    if (priceCents == null || priceCents < 100) return setEditError("Preço mínimo é R$1,00.");
    setEditSaving(true);
    try {
      const res = await fetch(`/api/numbers/${numberId}/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          priceCents,
          description: editDescription.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar oferta.");
      setEditingId(null);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erro ao salvar oferta.");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(offer: OfferItem) {
    await fetch(`/api/numbers/${numberId}/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !offer.active }),
    });
    await load();
  }

  async function removeOffer(offer: OfferItem) {
    await fetch(`/api/numbers/${numberId}/offers/${offer.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-xs font-semibold text-slate-600">Ofertas</p>
      <p className="text-xs text-slate-400">
        A IA apresenta uma destas ofertas e gera a cobrança Pix quando o lead demonstra intenção
        de compra. O preço é fixo (fonte de verdade) — a IA nunca o altera.
      </p>

      {offers === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Carregando…
        </div>
      ) : offers.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhuma oferta cadastrada.</p>
      ) : (
        <ul className="space-y-1.5">
          {offers.map((o) =>
            editingId === o.id ? (
              // ── Modo edição ─────────────────────────────────────────────
              <li key={o.id} className="space-y-2 rounded-lg border border-brand-200 bg-card px-3 py-2.5">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Nome"
                    className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <input
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="Preço (R$)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
                  />
                </div>
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                {editError && <p className="text-xs text-[#C0392B]">{editError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={editSaving}>
                    <X size={14} /> Cancelar
                  </Button>
                  <Button size="sm" onClick={() => saveEdit(o.id)} loading={editSaving}>
                    <Check size={14} /> Salvar
                  </Button>
                </div>
              </li>
            ) : (
              // ── Modo leitura ────────────────────────────────────────────
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-default bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {o.name} <span className="text-slate-500">• {formatCentsBRL(o.priceCents)}</span>
                  </p>
                  {o.description && <p className="truncate text-xs text-slate-400">{o.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={o.active}
                      onChange={() => toggleActive(o)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                    />
                    Ativa
                  </label>
                  <button
                    type="button"
                    onClick={() => startEdit(o)}
                    className="text-slate-400 hover:text-brand-600"
                    aria-label="Editar oferta"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOffer(o)}
                    className="text-slate-400 hover:text-[#C0392B]"
                    aria-label="Remover oferta"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex.: Mentoria)"
          className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço (R$)"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descrição (opcional)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      {error && <p className="text-xs text-[#C0392B]">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={addOffer} loading={saving} disabled={!name.trim() || !price.trim()}>
          Adicionar oferta
        </Button>
      </div>
    </div>
  );
}
