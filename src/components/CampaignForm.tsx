"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

const DEFAULT_TEMPLATE =
  "Olá {{nome}}! Aqui é da Acme. Vi que sua empresa pode se beneficiar da nossa solução. Posso te fazer algumas perguntas rápidas?";

/**
 * Formulário de criação de campanha. Ao salvar, associa todos os leads `NOVO`
 * à campanha (o disparo é um passo separado, na lista).
 */
export function CampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Informe um nome para a campanha.");
      return;
    }
    if (!/\{\{\s*nome\s*\}\}/i.test(template)) {
      setError("O template deve conter {{nome}}.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), messageTemplate: template }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar campanha");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar campanha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Nome da campanha
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Prospecção — Setor de Serviços"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Mensagem inicial
        </label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="mt-1 text-xs text-slate-400">
          Use <code>{"{{nome}}"}</code> para personalizar com o nome do lead.
        </p>
      </div>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Ao criar, todos os leads com status <strong>Novo</strong> serão
        associados a esta campanha. O disparo é feito depois, pelo botão
        “Iniciar”.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={loading}>
          Criar campanha
        </Button>
      </div>
    </div>
  );
}
