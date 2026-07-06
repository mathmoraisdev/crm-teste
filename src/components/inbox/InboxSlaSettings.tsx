"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const inputClass =
  "w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Define a meta de SLA do inbox (minutos até a 1ª resposta humana). Vazio/0 =
 * sem meta (nunca marca estouro). Aplica-se à conta toda.
 */
export function InboxSlaSettings({
  initial,
  canEdit = true,
}: {
  initial: number | null;
  canEdit?: boolean;
}) {
  const [value, setValue] = useState<string>(initial != null ? String(initial) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const trimmed = value.trim();
    const minutes = trimmed === "" ? null : Number(trimmed);
    if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) {
      setError("Informe um número de minutos entre 0 e 1440 (ou deixe vazio).");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/account/inbox-sla", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inboxSlaMinutes: minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar meta de SLA");
      setValue(data.inboxSlaMinutes != null ? String(data.inboxSlaMinutes) : "");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar meta de SLA");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Meta de resposta (SLA)"
        subtitle="Tempo alvo até a 1ª resposta humana no inbox. A fila destaca as conversas que estouram a meta. Deixe vazio para não usar meta."
      />
      <div className="px-4 py-3">
        {error && (
          <p className="mb-2 rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Minutos</label>
            <input
              type="number"
              min={0}
              max={1440}
              value={value}
              disabled={!canEdit}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              placeholder="ex.: 5"
              className={inputClass}
            />
          </div>
          {canEdit && (
            <Button size="sm" onClick={save} loading={saving}>
              Salvar
            </Button>
          )}
          {saved && <span className="pb-2 text-xs text-brand-600">Salvo ✓</span>}
        </div>
      </div>
    </Card>
  );
}
