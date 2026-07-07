"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Pencil, Check, X, Sparkles, Copy } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import { BUSINESS_TEMPLATES, CATEGORY_LABEL, catalogSeedItems, getTemplate, type BusinessCategory } from "@/lib/business-templates";
import CatalogItemPhotos from "@/components/vendas/CatalogItemPhotos";
import CatalogItemSpecs from "@/components/vendas/CatalogItemSpecs";

interface Item {
  id: string;
  kind: "SERVICO" | "PRODUTO";
  name: string;
  priceCents: number;
  active: boolean;
  trackStock: boolean;
  sku: string | null;
  barcode: string | null;
  variantGroup: string | null;
  stockQty: number;
  minStock: number;
  costCents: number | null;
  printSector: string | null;
  durationMinutes: number | null;
  customFields?: Record<string, unknown> | null;
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

/** Campo com rótulo persistente acima do input — evita depender do placeholder,
 * que some ao preencher (aí "camisa-p" e "500" ficam sem dizer o que são). O
 * wrapper carrega a largura (flex-1 / sm:w-*) quando os campos ficam em linha. */
function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

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
  const [trackStock, setTrackStock] = useState(false);
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [variantGroup, setVariantGroup] = useState("");
  const [initialQty, setInitialQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [costStr, setCostStr] = useState("");
  const [sector, setSector] = useState("");
  const [duration, setDuration] = useState("");
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
  const [editTrackStock, setEditTrackStock] = useState(false);
  const [editSku, setEditSku] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editVariantGroup, setEditVariantGroup] = useState("");
  const [editMinStock, setEditMinStock] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editSector, setEditSector] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Foco no Nome ao abrir edição via "Duplicar" (troca rápida do rótulo da variação).
  const editNameRef = useRef<HTMLInputElement>(null);

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

  // Grade (SKU flat): agrupa itens com o mesmo variantGroup sob um subcabeçalho. A
  // ordenação é estável e no-op quando ninguém usa grade (null ordena por último →
  // ordem original preservada). Só apresentação: cada linha continua editável isolada.
  const orderedItems = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => (a.variantGroup ?? "￿").localeCompare(b.variantGroup ?? "￿"));
  }, [items]);
  const groupHeaders = useMemo(() => {
    const m = new Map<string, string>();
    let prev: string | null = null;
    for (const it of orderedItems) {
      if (it.variantGroup && it.variantGroup !== prev) m.set(it.id, it.variantGroup);
      prev = it.variantGroup ?? null;
    }
    return m;
  }, [orderedItems]);

  function resetAddForm() {
    setName("");
    setPrice("");
    setKind("SERVICO");
    setTrackStock(false);
    setSku("");
    setBarcode("");
    setVariantGroup("");
    setInitialQty("");
    setMinStock("");
    setCostStr("");
    setSector("");
    setDuration("");
  }

  async function addItem() {
    setError(null);
    const priceCents = parseBRLToCents(price);
    if (!name.trim()) return setError("Informe o nome.");
    if (priceCents == null) return setError("Preço inválido.");
    const useStock = kind === "PRODUTO" && trackStock;
    const initial = useStock ? Math.max(0, Math.floor(Number(initialQty) || 0)) : 0;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), priceCents, kind, printSector: sector.trim() || null };
      // Duração só para serviço; vazio → null.
      if (kind === "SERVICO") {
        const d = Math.floor(Number(duration));
        body.durationMinutes = duration.trim() && Number.isFinite(d) && d > 0 ? d : null;
      }
      // Código de barras e grupo de grade: fazem sentido em qualquer PRODUTO, independem de estoque.
      if (kind === "PRODUTO") {
        body.barcode = barcode.trim() || null;
        body.variantGroup = variantGroup.trim() || null;
      }
      if (useStock) {
        body.trackStock = true;
        body.sku = sku.trim() || null;
        body.minStock = Math.max(0, Math.floor(Number(minStock) || 0));
        body.costCents = parseBRLToCents(costStr) ?? null;
      }
      const res = await fetch("/api/vendas/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
      // Estoque inicial entra como um movimento de ENTRADA (nunca setamos stockQty direto).
      if (useStock && initial > 0 && data?.item?.id) {
        await fetch(`/api/vendas/stock/${data.item.id}/entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty: initial, reason: "Estoque inicial" }),
        });
      }
      resetAddForm();
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
    setEditTrackStock(it.trackStock);
    setEditSku(it.sku ?? "");
    setEditBarcode(it.barcode ?? "");
    setEditVariantGroup(it.variantGroup ?? "");
    setEditMinStock(it.trackStock ? String(it.minStock) : "");
    setEditCost(it.costCents != null ? formatCentsBRL(it.costCents) : "");
    setEditSector(it.printSector ?? "");
    setEditDuration(it.durationMinutes != null ? String(it.durationMinutes) : "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  // Duplica o item e já abre a cópia em edição, com o cursor no Nome. Copia
  // descritivos + ficha; sku/barcode vêm vazios e o estoque em 0 (ver o service).
  async function duplicate(it: Item) {
    setError(null);
    try {
      const res = await fetch(`/api/vendas/catalog/${it.id}/duplicate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Erro ao duplicar.");
        return;
      }
      await load();
      startEdit(data.item as Item);
      // Após o render do modo de edição, foca e seleciona o Nome (troca rápida).
      setTimeout(() => {
        editNameRef.current?.focus();
        editNameRef.current?.select();
      }, 0);
    } catch {
      setError("Erro ao duplicar.");
    }
  }

  async function saveEdit(id: string) {
    setEditError(null);
    const priceCents = parseBRLToCents(editPrice);
    if (!editName.trim()) return setEditError("Informe o nome.");
    if (priceCents == null) return setEditError("Preço inválido.");
    setEditSaving(true);
    try {
      const patch: Record<string, unknown> = { name: editName.trim(), priceCents, kind: editKind, printSector: editSector.trim() || null };
      // Duração só para serviço; vazio → null (produto sempre zera).
      if (editKind === "SERVICO") {
        const d = Math.floor(Number(editDuration));
        patch.durationMinutes = editDuration.trim() && Number.isFinite(d) && d > 0 ? d : null;
      } else {
        patch.durationMinutes = null;
      }
      if (editKind === "PRODUTO") {
        patch.trackStock = editTrackStock;
        patch.barcode = editBarcode.trim() || null;
        patch.variantGroup = editVariantGroup.trim() || null;
        if (editTrackStock) {
          patch.sku = editSku.trim() || null;
          patch.minStock = Math.max(0, Math.floor(Number(editMinStock) || 0));
          patch.costCents = parseBRLToCents(editCost) ?? null;
        }
      } else {
        patch.trackStock = false;
        patch.barcode = null;
        patch.variantGroup = null;
      }
      const res = await fetch(`/api/vendas/catalog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
    const res = await fetch(`/api/vendas/catalog/${it.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Erro ao remover o item.");
    }
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
            <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-4 dark:border-brand-500/30 dark:bg-brand-500/10">
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
                  className="w-full flex-1 rounded-lg border border-line-default bg-inset px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
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
            {orderedItems.map((it) => (
              <Fragment key={it.id}>
                {groupHeaders.has(it.id) && (
                  <li className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {groupHeaders.get(it.id)}
                  </li>
                )}
                {editingId === it.id ? (
                // ── Modo edição ──────────────────────────────────────────
                <li className="space-y-2 rounded-lg border border-brand-200 bg-card px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Field label="Nome" className="flex-1">
                      <input
                        ref={editNameRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="ex.: Corte"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                    <Field label="Tipo" className="sm:w-32">
                      <select
                        value={editKind}
                        onChange={(e) => setEditKind(e.target.value as "SERVICO" | "PRODUTO")}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      >
                        <option value="SERVICO">Serviço</option>
                        <option value="PRODUTO">Produto</option>
                      </select>
                    </Field>
                    <Field label="Preço (R$)" className="sm:w-32">
                      <input
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        placeholder="0,00"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                  </div>
                  <Field label="Setor de produção">
                    <input
                      value={editSector}
                      onChange={(e) => setEditSector(e.target.value)}
                      placeholder="ex.: cozinha, bar — opcional"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </Field>
                  {editKind === "SERVICO" && (
                    <Field label="Duração (min)">
                      <input
                        value={editDuration}
                        onChange={(e) => setEditDuration(e.target.value)}
                        inputMode="numeric"
                        placeholder="opcional"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                  )}
                  {editKind === "PRODUTO" && (
                    <div className="space-y-2 rounded-lg border border-line-default bg-inset px-3 py-2.5">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Field label="Código de barras (EAN)" className="flex-1">
                          <input
                            value={editBarcode}
                            onChange={(e) => setEditBarcode(e.target.value)}
                            placeholder="opcional"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        </Field>
                        <Field label="Grupo/grade" className="flex-1">
                          <input
                            value={editVariantGroup}
                            onChange={(e) => setEditVariantGroup(e.target.value)}
                            placeholder="ex.: Camiseta — opcional"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={editTrackStock}
                          onChange={(e) => setEditTrackStock(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                        />
                        Controlar estoque
                      </label>
                      {editTrackStock && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Field label="SKU" className="flex-1">
                            <input
                              value={editSku}
                              onChange={(e) => setEditSku(e.target.value)}
                              placeholder="ex.: CAM-P"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            />
                          </Field>
                          <Field label="Estoque mínimo" className="sm:w-28">
                            <input
                              value={editMinStock}
                              onChange={(e) => setEditMinStock(e.target.value)}
                              inputMode="numeric"
                              placeholder="0"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            />
                          </Field>
                          <Field label="Custo (R$)" className="sm:w-32">
                            <input
                              value={editCost}
                              onChange={(e) => setEditCost(e.target.value)}
                              placeholder="0,00"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            />
                          </Field>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400">O saldo só muda pela aba Estoque (entrada/ajuste).</p>
                    </div>
                  )}
                  {editKind === "PRODUTO" && (
                    <div className="mt-2 space-y-3 border-t border-line-default pt-2">
                      <CatalogItemPhotos itemId={it.id} canEdit={canEdit} />
                      <CatalogItemSpecs itemId={it.id} initialValues={it.customFields ?? null} canEdit={canEdit} />
                    </div>
                  )}
                  {editError && <p className="text-xs text-danger">{editError}</p>}
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-default bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {it.name}{" "}
                      <span className="text-slate-500">• {formatCentsBRL(it.priceCents)}</span>
                    </p>
                    <p className="flex items-center gap-2 text-xs text-slate-400">
                      {it.kind === "SERVICO" ? "Serviço" : "Produto"}
                      {it.kind === "SERVICO" && it.durationMinutes != null && (
                        <span>· {it.durationMinutes} min</span>
                      )}
                      {it.printSector && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {it.printSector}
                        </span>
                      )}
                      {it.trackStock && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            it.stockQty <= it.minStock ? "bg-danger/10 text-danger" : "bg-brand-50 text-brand-700"
                          }`}
                        >
                          Estoque: {it.stockQty}
                        </span>
                      )}
                      {it.barcode && <span className="text-[11px] text-slate-400">#{it.barcode}</span>}
                    </p>
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
                        onClick={() => void duplicate(it)}
                        className="text-slate-400 hover:text-brand-600"
                        aria-label="Duplicar item"
                        title="Duplicar item"
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(it)}
                        className="text-slate-400 hover:text-brand-600"
                        aria-label="Editar item"
                      >
                        <Pencil size={15} />
                      </button>
                      <ConfirmDeleteButton
                        onConfirm={() => remove(it)}
                        label="Remover item"
                        title="Remover item do catálogo"
                        message={
                          <>
                            Remover <strong>{it.name}</strong> do catálogo? Comandas antigas
                            mantêm o registro; esta ação não pode ser desfeita.
                          </>
                        }
                        confirmLabel="Remover"
                      />
                    </div>
                  )}
                </li>
                )}
              </Fragment>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold text-slate-600">Adicionar item</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Field label="Nome" className="flex-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex.: Corte"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </Field>
              <Field label="Tipo" className="sm:w-32">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "SERVICO" | "PRODUTO")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="SERVICO">Serviço</option>
                  <option value="PRODUTO">Produto</option>
                </select>
              </Field>
              <Field label="Preço (R$)" className="sm:w-32">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </Field>
            </div>
            <Field label="Setor de produção">
              <input
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="ex.: cozinha, bar — opcional"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </Field>
            {kind === "SERVICO" && (
              <Field label="Duração (min)">
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  inputMode="numeric"
                  placeholder="opcional"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </Field>
            )}
            {kind === "PRODUTO" && (
              <div className="space-y-2 rounded-lg border border-line-default bg-card px-3 py-2.5">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Field label="Código de barras (EAN)" className="flex-1">
                    <input
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="opcional"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </Field>
                  <Field label="Grupo/grade" className="flex-1">
                    <input
                      value={variantGroup}
                      onChange={(e) => setVariantGroup(e.target.value)}
                      placeholder="ex.: Camiseta — opcional"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={trackStock}
                    onChange={(e) => setTrackStock(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                  />
                  Controlar estoque
                </label>
                {trackStock && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Field label="SKU" className="flex-1">
                      <input
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder="ex.: CAM-P"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                    <Field label="Estoque inicial" className="sm:w-32">
                      <input
                        value={initialQty}
                        onChange={(e) => setInitialQty(e.target.value)}
                        inputMode="numeric"
                        placeholder="0"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                    <Field label="Estoque mínimo" className="sm:w-28">
                      <input
                        value={minStock}
                        onChange={(e) => setMinStock(e.target.value)}
                        inputMode="numeric"
                        placeholder="0"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                    <Field label="Custo (R$)" className="sm:w-32">
                      <input
                        value={costStr}
                        onChange={(e) => setCostStr(e.target.value)}
                        placeholder="0,00"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
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
