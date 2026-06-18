"use client";

import { useState } from "react";
import type { LeadStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { LEAD_STATUS_META, PIPELINE_ORDER } from "@/lib/leadStatus";

export interface LeadFormValues {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: LeadStatus;
  optOut: boolean;
}

/**
 * Formulário de lead. Sem `lead` cria um lead avulso (status NOVO); com `lead`
 * edita nome, telefone, status do pipeline e opt-out.
 */
export function LeadForm({
  lead,
  onSaved,
}: {
  lead?: LeadFormValues;
  onSaved: () => void;
}) {
  const editing = !!lead;
  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "NOVO");
  const [optOut, setOptOut] = useState(lead?.optOut ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Informe o nome do lead.");
      return;
    }
    if (!phone.trim()) {
      setError("Informe o telefone do lead.");
      return;
    }
    setLoading(true);
    try {
      const body = editing
        ? { name: name.trim(), phone: phone.trim(), email: email.trim(), status, optOut }
        : { name: name.trim(), phone: phone.trim(), email: email.trim() };
      const res = await fetch(editing ? `/api/leads/${lead!.id}` : "/api/leads", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar lead");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar lead");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Maria Silva"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Telefone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(11) 98888-1111"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="mt-1 text-xs text-slate-400">
          Aceita formato livre — é normalizado para E.164 (assume Brasil sem DDI).
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          E-mail <span className="text-slate-400">(opcional)</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="maria@empresa.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="mt-1 text-xs text-slate-400">
          A IA também captura sozinha quando o lead informa na conversa.
        </p>
      </div>

      {editing && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Status no pipeline
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {PIPELINE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={optOut}
              onChange={(e) => setOptOut(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/40"
            />
            Marcado como opt-out (não recebe mensagens)
          </label>
        </>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={loading}>
          {editing ? "Salvar alterações" : "Adicionar lead"}
        </Button>
      </div>
    </div>
  );
}
