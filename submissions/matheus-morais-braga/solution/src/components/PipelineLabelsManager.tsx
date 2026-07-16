"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LEAD_STATUS_META, PIPELINE_ORDER, type PipelineLabels } from "@/lib/leadStatus";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Renomeia os rótulos das etapas do funil (sem mexer no enum, que sustenta a IA).
 * Deixar em branco usa o rótulo padrão.
 */
export function PipelineLabelsManager({ canEdit = true }: { canEdit?: boolean }) {
  const [values, setValues] = useState<PipelineLabels>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setValues((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/account/pipeline-labels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labels: values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setValues((data.labels as PipelineLabels) ?? {});
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Rótulos do funil"
        subtitle="Renomeie as etapas do pipeline. As etapas em si continuam as mesmas (a IA depende delas)."
      />
      <div className="space-y-3 px-4 py-3">
        {PIPELINE_ORDER.map((status) => (
          <div key={status} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-xs font-medium text-slate-500">
              {LEAD_STATUS_META[status].label}
            </span>
            <input
              value={values[status] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [status]: e.target.value }))}
              placeholder={LEAD_STATUS_META[status].label}
              className={inputClass}
              disabled={!canEdit}
            />
          </div>
        ))}
        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {!canEdit ? (
          <p className="text-sm text-slate-500">
            Apenas o administrador da conta pode renomear as etapas do funil.
          </p>
        ) : (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
            <Button size="sm" onClick={save} loading={saving}>
              Salvar rótulos
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
