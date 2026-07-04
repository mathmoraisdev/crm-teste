"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BUSINESS_TEMPLATES, CATEGORY_LABEL, type BusinessCategory } from "@/lib/business-templates";

const selectClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-400";

const GROUPS = (Object.keys(CATEGORY_LABEL) as BusinessCategory[])
  .map((c) => ({ category: c, label: CATEGORY_LABEL[c], templates: BUSINESS_TEMPLATES.filter((t) => t.category === c) }))
  .filter((g) => g.templates.length > 0);

/**
 * Ramo do negócio no nível conta. Pré-configura o modelo de Atendimento dos
 * números e habilita semear o catálogo do ramo. Só o admin edita.
 */
export function BusinessCategorySettings({ canEdit, initial }: { canEdit: boolean; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const r = await fetch("/api/account/business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessTemplateId: value || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Erro");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Meu negócio"
        subtitle="Seu ramo pré-configura o atendimento da IA e sugere um catálogo pronto."
      />
      <div className="space-y-3 px-4 py-3">
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className={selectClass}
          disabled={!canEdit}
        >
          <option value="">Não definido</option>
          {GROUPS.map((g) => (
            <optgroup key={g.category} label={g.label}>
              {g.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!canEdit ? (
          <p className="text-sm text-slate-500">Apenas o administrador da conta pode definir o ramo do negócio.</p>
        ) : (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
            <Button size="sm" onClick={save} loading={saving}>
              Salvar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
