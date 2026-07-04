"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Trash2, Check, X, Sparkles } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import { BUSINESS_TEMPLATES, CATEGORY_LABEL, catalogSeedItems, getTemplate, type BusinessCategory } from "@/lib/business-templates";

interface Item {
  id: string;
  kind: "SERVICO" | "PRODUTO";
  name: string;
  priceCents: number;
  active: boolean;
}

// Modelos que geram itens (ordenados por categoria) — pré-computado, é estático.
const SEED_GROUPS: { category: BusinessCategory; label: string; templates: { id: string; label: string; count: number }[] }[] =
  (Object.keys(CATEGORY_LABEL) as BusinessCategory[])
    .map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      templates: BUSINESS_TEMPLATES.filter((t) => t.category === category)
        .map((t) => ({ id: t.id, label: t.label, count: catalogSeedItems(t).length }))
        .filter((t) => t.count > 0),
    }))
    .filter((g) => g.templates.length > 0);

/**
 * Gestão do catálogo (serviços/produtos com preço) da conta. Fala com
 * /api/vendas/catalog. Cadastrar/editar exige canSettings (canEdit); sem isso o
 * form fica desabilitado (operador só registra comanda, não mexe no catálogo).
 */
export function CatalogManager({
  canEdit,
  accountBusinessId = null,
}: {
  canEdit: boolean;
  accountBusinessId?: string | null;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<"SERVICO" | "PRODUTO">("SERVICO");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Semear a partir do ramo (estado-vazio).
  const [seedTemplateId, setSeedTemplateId] = useState("");
  const [seeding, setSeeding] = useState(false);

  // Edição inline.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editKind, setEditKind] = useState<"SERVICO" | "PRODUTO">("SERVICO");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/catalog", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items as Item[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addItem() {
    setError(null);
    const priceCents = parseBRLToCents(price);
    if (!name.trim()) return setError("Informe o nome.");
    if (priceCents == null) return setError("Preço inválido.");
    setSaving(true);
    try {
      const res = await fetch("/api/vendas/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), priceCents, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
      setName("");
      setPrice("");
      setKind("SERVICO");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name);
    setEditPrice(formatCentsBRL(it.priceCents));
    setEditKind(it.kind);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditError(null);
    const priceCents = parseBRLToCents(editPrice);
    if (!editName.trim()) return setEditError("Informe o nome.");
    if (priceCents == null) return setEditError("Preço inválido.");
    setEditSaving(true);
    try {
      const res = await fetch(`/api/vendas/catalog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), priceCents, kind: editKind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
      setEditingId(null);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(it: Item) {
    await fetch(`/api/vendas/catalog/${it.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !it.active }),
    });
    await load();
  }

  async function remove(it: Item) {
    await fetch(`/api/vendas/catalog/${it.id}`, { method: "DELETE" });
    await load();
  }

  async function seedFromTemplate(templateId: string = seedTemplateId) {
    if (!templateId) return;
    setError(null);
    setSeeding(true);
    try {
      const r = await fetch("/api/vendas/catalog/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Erro ao aplicar modelo.");
      setSeedTemplateId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao aplicar modelo.");
    } finally {
      setSeeding(false);
    }
  }

  // Ramo da conta, só se ele gera itens concretos (senão o atalho não faz sentido).
  const accountTemplate = accountBusinessId ? getTemplate(accountBusinessId) : undefined;
  const accountSeed =
    accountTemplate && catalogSeedItems(accountTemplate).length > 0 ? accountTemplate : null;

  return (
    <Card>
      <CardHeader
        title="Catálogo"
        subtitle="Cadastre seus serviços e produtos com preço. Eles aparecem na hora de montar uma comanda."
      />

      <div className="space-y-4 px-5 py-4">
        {items === null ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Carregando…
          </div>
        ) : items.length === 0 ? (
          canEdit ? (
            <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-4">
              <div className="flex items-start gap-2">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <p className="text-sm font-semibold text-ink">Comece rápido pelo seu ramo</p>
                  <p className="text-xs text-slate-500">
                    Escolha um modelo e a gente já cadastra os itens típicos — depois é só ajustar o preço, o nome ou adicionar mais.
                  </p>
                </div>
              </div>
              {accountSeed && (
                <div className="flex flex-col gap-1.5">
                  <Button onClick={() => seedFromTemplate(accountSeed.id)} loading={seeding} className="justify-center">
                    Usar o modelo do seu ramo ({accountSeed.label})
                  </Button>
                  <p className="text-center text-xs text-slate-400">Ou escolha outro ramo abaixo.</p>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={seedTemplateId}
                  onChange={(e) => setSeedTemplateId(e.target.value)}
                  className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">Escolha o ramo do seu negócio…</option>
                  {SEED_GROUPS.map((g) => (
                    <optgroup key={g.category} label={g.label}>
                      {g.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label} ({t.count} {t.count === 1 ? "item" : "itens"})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button onClick={() => seedFromTemplate()} loading={seeding} disabled={!seedTemplateId}>
                  Usar modelo
                </Button>
              </div>
              <p className="text-xs text-slate-400">Ou cadastre manualmente abaixo.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nenhum item cadastrado ainda.</p>
          )
        ) : (
          <ul className="space-y-1.5">
            {items.map((it) =>
              editingId === it.id ? (
                // ── Modo edição ──────────────────────────────────────────
                <li key={it.id} className="space-y-2 rounded-lg border border-brand-200 bg-white px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nome"
                      className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <select
                      value={editKind}
                      onChange={(e) => setEditKind(e.target.value as "SERVICO" | "PRODUTO")}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
                    >
                      <option value="SERVICO">Serviço</option>
                      <option value="PRODUTO">Produto</option>
                    </select>
                    <input
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      placeholder="Preço (R$)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
                    />
                  </div>
                  {editError && <p className="text-xs text-[#C0392B]">{editError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={editSaving}>
                      <X size={14} /> Cancelar
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(it.id)} loading={editSaving}>
                      <Check size={14} /> Salvar
                    </Button>
                  </div>
                </li>
              ) : (
                // ── Modo leitura ─────────────────────────────────────────
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {it.name}{" "}
                      <span className="text-slate-500">• {formatCentsBRL(it.priceCents)}</span>
                    </p>
                    <p className="text-xs text-slate-400">{it.kind === "SERVICO" ? "Serviço" : "Produto"}</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={it.active}
                          onChange={() => toggleActive(it)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                        />
                        Ativo
                      </label>
                      <button
                        type="button"
                        onClick={() => startEdit(it)}
                        className="text-slate-400 hover:text-brand-600"
                        aria-label="Editar item"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(it)}
                        className="text-slate-400 hover:text-[#C0392B]"
                        aria-label="Remover item"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        {canEdit ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold text-slate-600">Adicionar item</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome (ex.: Corte)"
                className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "SERVICO" | "PRODUTO")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
              >
                <option value="SERVICO">Serviço</option>
                <option value="PRODUTO">Produto</option>
              </select>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Preço (R$)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
              />
            </div>
            {error && <p className="text-xs text-[#C0392B]">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={addItem} loading={saving} disabled={!name.trim() || !price.trim()}>
                Adicionar
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Seu usuário não tem permissão para cadastrar itens do catálogo.
          </p>
        )}
      </div>
    </Card>
  );
}
