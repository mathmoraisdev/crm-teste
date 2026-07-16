"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";

// O usuário escolhe um "tipo" por grupo; ele mapeia p/ minSelect/maxSelect. Para
// os tipos múltiplos, maxSelect = nº de opções (deixa marcar todas). Ver plano.
type GType = "single-required" | "single-optional" | "multi-optional" | "multi-required";

const TYPE_LABELS: Record<GType, string> = {
  "single-required": "Escolha única obrigatória",
  "single-optional": "Única opcional",
  "multi-optional": "Múltipla",
  "multi-required": "Múltipla obrigatória",
};

interface OptionDraft { name: string; price: string; active: boolean }
interface GroupDraft { name: string; type: GType; options: OptionDraft[] }

function typeFromLimits(minSelect: number, maxSelect: number): GType {
  if (maxSelect <= 1) return minSelect >= 1 ? "single-required" : "single-optional";
  return minSelect >= 1 ? "multi-required" : "multi-optional";
}

function limitsFromType(type: GType, optionCount: number): { minSelect: number; maxSelect: number } {
  switch (type) {
    case "single-required": return { minSelect: 1, maxSelect: 1 };
    case "single-optional": return { minSelect: 0, maxSelect: 1 };
    case "multi-required": return { minSelect: 1, maxSelect: Math.max(1, optionCount) };
    case "multi-optional": return { minSelect: 0, maxSelect: Math.max(1, optionCount) };
  }
}

const emptyOption = (): OptionDraft => ({ name: "", price: "", active: true });
const emptyGroup = (): GroupDraft => ({ name: "", type: "single-required", options: [emptyOption()] });

const inputCls =
  "min-w-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60";

/**
 * Editor dos grupos de adicionais/variações de um item do catálogo (onda-N).
 * Replace-all: carrega o conjunto no mount e substitui tudo no PUT. Só aparece p/
 * itens já criados (precisa de catalogItemId) e edita quando canEdit.
 */
export default function ModifierGroupsEditor({ catalogItemId, canEdit }: { catalogItemId: string; canEdit: boolean }) {
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vendas/catalog/${catalogItemId}/modifiers`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const gs = (d.groups ?? []) as Array<{
          name: string; minSelect: number; maxSelect: number;
          options: Array<{ name: string; priceDeltaCents: number; active: boolean }>;
        }>;
        setGroups(gs.map((g) => ({
          name: g.name,
          type: typeFromLimits(g.minSelect, g.maxSelect),
          options: (g.options ?? []).map((o) => ({
            name: o.name,
            price: o.priceDeltaCents ? formatCentsBRL(o.priceDeltaCents) : "",
            active: o.active,
          })),
        })));
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [catalogItemId]);

  function mutateGroup(gi: number, patch: Partial<GroupDraft>) {
    setGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
    setSaved(false);
  }
  function mutateOption(gi: number, oi: number, patch: Partial<OptionDraft>) {
    setGroups((prev) => prev.map((g, i) => i === gi
      ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) }
      : g));
    setSaved(false);
  }
  function removeOption(gi: number, oi: number) {
    setGroups((prev) => prev.map((g, i) => i === gi
      ? { ...g, options: g.options.filter((_, j) => j !== oi) }
      : g));
    setSaved(false);
  }
  function removeGroup(gi: number) {
    setGroups((prev) => prev.filter((_, i) => i !== gi));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload = {
        groups: groups.map((g) => {
          const { minSelect, maxSelect } = limitsFromType(g.type, g.options.length);
          return {
            name: g.name.trim(),
            minSelect, maxSelect,
            options: g.options.map((o) => ({
              name: o.name.trim(),
              priceDeltaCents: parseBRLToCents(o.price) ?? 0,
              active: o.active,
            })),
          };
        }),
      };
      const res = await fetch(`/api/vendas/catalog/${catalogItemId}/modifiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Falha ao salvar"); return; }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-ink">Adicionais e variações</div>
      <p className="text-[11px] text-slate-400">
        Grupos de escolha ao adicionar o item (ex.: Tamanho, Adicionais). O preço soma no item.
      </p>
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-2 rounded-lg border border-line-default bg-card p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={g.name}
              onChange={(e) => mutateGroup(gi, { name: e.target.value })}
              placeholder="Nome do grupo (ex.: Tamanho)"
              disabled={!canEdit}
              className={`flex-1 ${inputCls}`}
            />
            <select
              value={g.type}
              onChange={(e) => mutateGroup(gi, { type: e.target.value as GType })}
              disabled={!canEdit}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
            >
              {(Object.keys(TYPE_LABELS) as GType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            {canEdit && (
              <button
                type="button"
                onClick={() => removeGroup(gi)}
                className="rounded-lg p-2 text-slate-400 hover:text-danger"
                aria-label="Remover grupo"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="space-y-1 pl-2">
            {g.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  value={o.name}
                  onChange={(e) => mutateOption(gi, oi, { name: e.target.value })}
                  placeholder="Opção (ex.: Grande)"
                  disabled={!canEdit}
                  className={`flex-1 ${inputCls}`}
                />
                <input
                  value={o.price}
                  onChange={(e) => mutateOption(gi, oi, { price: e.target.value })}
                  placeholder="+ R$ 0,00"
                  inputMode="decimal"
                  disabled={!canEdit}
                  className={`w-28 ${inputCls}`}
                />
                {canEdit && g.options.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeOption(gi, oi)}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-danger"
                    aria-label="Remover opção"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={() => mutateGroup(gi, { options: [...g.options, emptyOption()] })}
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
              >
                <Plus size={12} /> Adicionar opção
              </button>
            )}
          </div>
        </div>
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setGroups((prev) => [...prev, emptyGroup()]); setSaved(false); }}>
            <Plus size={14} /> Adicionar grupo
          </Button>
          {groups.length > 0 && (
            <Button size="sm" onClick={() => void save()} loading={saving}>
              {saving ? "Salvando…" : "Salvar adicionais"}
            </Button>
          )}
          {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
