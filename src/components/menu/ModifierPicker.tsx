"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL } from "@/lib/money";

// Componente PRESENTACIONAL e compartilhado (PDV + cardápio público). Recebe os
// grupos prontos; quem chama é dono do fetch (PDV: GET autenticado; cardápio: DTO
// do menu). Valida min/max no client e retorna só a lista de optionIds escolhidos —
// o servidor SEMPRE reconfere e é a fonte de verdade do preço (modifier.service).
export interface PickerOption { id: string; name: string; priceDeltaCents: number; active?: boolean }
export interface PickerGroup { id?: string; name: string; minSelect: number; maxSelect: number; options: PickerOption[] }

export function ModifierPicker({
  itemName,
  basePriceCents,
  groups,
  onConfirm,
  onClose,
  busy = false,
}: {
  itemName: string;
  basePriceCents: number;
  groups: PickerGroup[];
  onConfirm: (optionIds: string[]) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  // seleção por grupo: índice do grupo → optionIds marcados
  const [selected, setSelected] = useState<Record<number, string[]>>({});

  // só opções ativas entram na tela e na conta
  const visibleGroups = useMemo(
    () => groups.map((g) => ({ ...g, options: g.options.filter((o) => o.active !== false) })),
    [groups],
  );

  function toggle(gi: number, group: PickerGroup, optionId: string) {
    setSelected((prev) => {
      const cur = prev[gi] ?? [];
      if (group.maxSelect <= 1) {
        // rádio: substitui (permite desmarcar se o grupo é opcional)
        if (cur.includes(optionId)) return { ...prev, [gi]: group.minSelect >= 1 ? cur : [] };
        return { ...prev, [gi]: [optionId] };
      }
      // checkbox: alterna, respeitando o teto de maxSelect
      if (cur.includes(optionId)) return { ...prev, [gi]: cur.filter((x) => x !== optionId) };
      if (cur.length >= group.maxSelect) return prev; // teto atingido → ignora o clique
      return { ...prev, [gi]: [...cur, optionId] };
    });
  }

  const allIds = useMemo(() => Object.values(selected).flat(), [selected]);
  const deltaCents = useMemo(() => {
    let sum = 0;
    for (const g of visibleGroups) for (const o of g.options) if (allIds.includes(o.id)) sum += o.priceDeltaCents;
    return sum;
  }, [visibleGroups, allIds]);

  const valid = visibleGroups.every((g, gi) => {
    const n = (selected[gi] ?? []).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{itemName}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-ink" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {visibleGroups.map((g, gi) => {
            const cur = selected[gi] ?? [];
            const hint = g.minSelect >= 1
              ? (g.maxSelect === 1 ? "Obrigatório · escolha 1" : `Obrigatório · ${g.minSelect} a ${g.maxSelect}`)
              : (g.maxSelect === 1 ? "Opcional · escolha 1" : `Opcional · até ${g.maxSelect}`);
            return (
              <div key={g.id ?? gi}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-ink">{g.name}</span>
                  <span className="text-[11px] text-slate-400">{hint}</span>
                </div>
                <div className="space-y-1">
                  {g.options.map((o) => {
                    const checked = cur.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-center justify-between rounded-lg border border-line-default px-3 py-2 text-sm hover:border-brand-300"
                      >
                        <span className="flex items-center gap-2 text-ink">
                          <input
                            type={g.maxSelect <= 1 ? "radio" : "checkbox"}
                            name={`grp-${gi}`}
                            checked={checked}
                            onChange={() => toggle(gi, g, o.id)}
                            className="accent-brand-600"
                          />
                          {o.name}
                        </span>
                        {o.priceDeltaCents > 0 && (
                          <span className="text-xs text-slate-500">+ {formatCentsBRL(o.priceDeltaCents)}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line-default pt-3">
          <span className="text-sm font-semibold text-ink">{formatCentsBRL(basePriceCents + deltaCents)}</span>
          <Button size="sm" onClick={() => onConfirm(allIds)} disabled={!valid || busy} loading={busy}>
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}
