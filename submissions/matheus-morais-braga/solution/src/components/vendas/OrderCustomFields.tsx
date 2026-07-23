"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CustomFieldInput } from "@/components/CustomFieldInput";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

/**
 * Bloco de campos customizados de uma comanda (scope=ORDER) ou item (scope=ORDER_ITEM).
 * Edita um rascunho local e persiste via `onSave` (PATCH na rota de fields) só quando
 * há mudança. Reutiliza `CustomFieldInput` — mesma renderização por tipo do LeadForm.
 */
export function OrderCustomFields({
  defs,
  values,
  onSave,
  title,
}: {
  defs: CustomFieldDefItem[];
  values: Record<string, unknown> | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  title?: string;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(values ?? {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (defs.length === 0) return null;

  function set(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar campos");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      )}
      {defs.map((d) => (
        <div key={d.id}>
          <CustomFieldInput def={d} value={draft[d.key]} onChange={(v) => set(d.key, v)} />
        </div>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      {dirty && (
        <Button size="sm" variant="secondary" onClick={save} loading={saving}>
          Salvar campos
        </Button>
      )}
    </div>
  );
}
