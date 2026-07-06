"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * Opt-in por conta das automações de ciclo de vida: pós-venda ("obrigado pela
 * preferência"), pedido de avaliação (NPS) e reengajamento de lead frio. Salva em
 * /api/account/lifecycle. É a 2ª chave — quais toques e com que atraso disparam é
 * definido pela plataforma (kill-switch + horas/dias). Enquanto desligado, nada
 * sai. As mensagens respeitam opt-out/LGPD e só saem em horário comercial.
 */
export function LifecycleSettings({
  initial,
  canEdit = true,
}: {
  initial: boolean;
  canEdit?: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/account/lifecycle", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lifecycleAutomationEnabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setEnabled(Boolean(data.lifecycleAutomationEnabled));
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
        title="Automações de ciclo de vida"
        subtitle="Mensagens automáticas para o funil não esfriar: um agradecimento após a comanda ser paga, um pedido de avaliação no dia seguinte e um reengajamento de quem conversou e sumiu."
      />
      <div className="space-y-4 px-4 py-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-ink">
              Ativar pós-venda, avaliação e reengajamento automáticos
            </span>
            <span className="block text-xs text-slate-500">
              Enquanto desligado, nada é enviado. As mensagens respeitam o descadastro (quem pediu
              para sair não recebe) e saem só em horário comercial.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {canEdit && (
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
