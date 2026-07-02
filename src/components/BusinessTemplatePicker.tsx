"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  BUSINESS_TEMPLATES,
  CATEGORY_LABEL,
  type BusinessCategory,
  type BusinessTemplate,
} from "@/lib/business-templates";

/** Categorias que realmente têm modelos, na ordem do CATEGORY_LABEL. */
function usedCategories(): BusinessCategory[] {
  const present = new Set(BUSINESS_TEMPLATES.map((t) => t.category));
  return (Object.keys(CATEGORY_LABEL) as BusinessCategory[]).filter((c) => present.has(c));
}

export function BusinessTemplatePicker({
  onApply,
}: {
  onApply: (tpl: BusinessTemplate) => void;
}) {
  const categories = useMemo(usedCategories, []);
  const [cat, setCat] = useState<BusinessCategory | "">("");
  const [tplId, setTplId] = useState("");

  const options = useMemo(
    () => (cat ? BUSINESS_TEMPLATES.filter((t) => t.category === cat) : []),
    [cat],
  );
  const selected = options.find((t) => t.id === tplId) ?? null;

  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-3">
      <p className="text-xs font-semibold text-slate-700">
        Começar por um modelo de negócio
      </p>
      <p className="text-xs text-slate-500">
        Escolha seu ramo para preencher persona, base de conhecimento e horário.
        Depois é só trocar os trechos entre <code>[colchetes]</code>.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select
          value={cat}
          onChange={(e) => {
            setCat(e.target.value as BusinessCategory | "");
            setTplId("");
          }}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">Categoria…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          value={tplId}
          onChange={(e) => setTplId(e.target.value)}
          disabled={!cat}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
        >
          <option value="">{cat ? "Ramo…" : "Escolha a categoria"}</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {selected && <p className="text-xs text-slate-500">{selected.blurb}</p>}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!selected}
          onClick={() => selected && onApply(selected)}
        >
          Aplicar modelo
        </Button>
      </div>
    </div>
  );
}
