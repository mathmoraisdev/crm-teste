"use client";

import { useEffect, useState } from "react";
import { CustomFieldInput } from "@/components/CustomFieldInput";
import { Button } from "@/components/ui/Button";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

export default function CatalogItemSpecs({
  itemId,
  initialValues,
  canEdit,
}: {
  itemId: string;
  initialValues: Record<string, unknown> | null;
  canEdit: boolean;
}) {
  const [defs, setDefs] = useState<CustomFieldDefItem[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>(initialValues ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/custom-fields?scope=PRODUCT", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDefs(d.defs ?? []))
      .catch(() => setDefs([]));
  }, []);

  if (defs.length === 0) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendas/catalog/${itemId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-ink">Ficha técnica</div>
      <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-2">
        {defs.map((d) => (
          <div key={d.id}>
            <CustomFieldInput
              def={d}
              value={draft[d.key]}
              onChange={(v) => setDraft((prev) => ({ ...prev, [d.key]: v }))}
            />
          </div>
        ))}
      </fieldset>
      {canEdit && (
        <Button size="sm" onClick={() => void save()} loading={saving}>
          {saving ? "Salvando…" : "Salvar ficha"}
        </Button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
