"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  BUSINESS_TEMPLATES,
  CATEGORY_LABEL,
  type BusinessCategory,
  type BusinessTemplate,
} from "@/lib/business-templates";
import { presetForCategory } from "@/lib/theme/presets";

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
  const [applyTheme, setApplyTheme] = useState(true);
  const [applying, setApplying] = useState(false);

  const options = useMemo(
    () => (cat ? BUSINESS_TEMPLATES.filter((t) => t.category === cat) : []),
    [cat],
  );
  const selected = options.find((t) => t.id === tplId) ?? null;
  // Preset dedicado da categoria (não o fallback verde), p/ oferecer as cores do ramo.
  const themePreset = useMemo(() => {
    if (!cat) return null;
    const p = presetForCategory(cat);
    return p.category === cat ? p : null;
  }, [cat]);

  async function apply() {
    if (!selected) return;
    onApply(selected);
    // Sugestão desacoplada: aplica também as cores do ramo. Best-effort — a API
    // gateia no dono (operador recebe 403, ignorado). Não bloqueia o template.
    if (applyTheme && themePreset) {
      setApplying(true);
      try {
        const form = new FormData();
        form.set("presetId", themePreset.id);
        await fetch("/api/branding", { method: "POST", body: form });
      } catch {
        // silencioso — o tema é opcional; a fonte de verdade é a aba Identidade
      } finally {
        setApplying(false);
      }
    }
  }

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
      {themePreset && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={applyTheme}
            onChange={(e) => setApplyTheme(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/30"
          />
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full border border-black/5"
              style={{ background: `rgb(${themePreset.palette["500"].replaceAll(" ", ",")})` }}
            />
            Aplicar também as cores deste ramo
          </span>
        </label>
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={!selected} loading={applying} onClick={apply}>
          Aplicar modelo
        </Button>
      </div>
    </div>
  );
}
