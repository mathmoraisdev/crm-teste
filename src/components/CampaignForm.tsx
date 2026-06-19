"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

const DEFAULT_TEMPLATE =
  "Olá {{nome}}! Aqui é da Acme. Vi que sua empresa pode se beneficiar da nossa solução. Posso te fazer algumas perguntas rápidas?";

export interface CampaignFormValues {
  id: string;
  name: string;
  messageTemplate: string;
  dailyCap: number | null;
}

/**
 * Formulário de campanha. Sem `campaign` cria uma nova (associando os leads
 * `NOVO`); com `campaign` edita a existente. O disparo é um passo separado.
 */
export function CampaignForm({
  campaign,
  onSaved,
}: {
  campaign?: CampaignFormValues;
  onSaved: () => void;
}) {
  const editing = !!campaign;
  const [name, setName] = useState(campaign?.name ?? "");
  const [template, setTemplate] = useState(campaign?.messageTemplate ?? DEFAULT_TEMPLATE);
  const [dailyCap, setDailyCap] = useState(
    campaign?.dailyCap != null ? String(campaign.dailyCap) : "",
  );
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
    let capValue: number | null = null;
    if (dailyCap.trim() !== "") {
      const n = Number(dailyCap);
      if (!Number.isInteger(n) || n <= 0) {
        setError("Cap diário deve ser um número inteiro positivo (ou vazio).");
        return;
      }
      capValue = n;
    }

    setLoading(true);
    try {
      const res = await fetch(
        editing ? `/api/campaigns/${campaign!.id}` : "/api/campaigns",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            messageTemplate: template,
            dailyCap: capValue,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar campanha");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar campanha");
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

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Cap diário (opcional)
        </label>
        <input
          type="number"
          min={1}
          value={dailyCap}
          onChange={(e) => setDailyCap(e.target.value)}
          placeholder="vazio = sem teto próprio"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="mt-1 text-xs text-slate-400">
          Máximo de mensagens iniciais <strong>desta campanha</strong> por dia
          (warm-up). Vazio = sem teto próprio. O limite global do sistema e o cap
          por chip continuam valendo por cima.
        </p>
      </div>

      {editing ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Alterar a mensagem só afeta <strong>envios futuros</strong>; o que já
          foi enfileirado mantém o texto anterior. Ao salvar, os leads{" "}
          <strong>Novo/Contatado sem campanha</strong> são associados a esta
          campanha (inclusive os criados depois).
        </p>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Ao criar, todos os leads com status <strong>Novo</strong> serão
          associados a esta campanha. O disparo é feito depois, pelo botão
          “Iniciar”.
        </p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={loading}>
          {editing ? "Salvar alterações" : "Criar campanha"}
        </Button>
      </div>
    </div>
  );
}
