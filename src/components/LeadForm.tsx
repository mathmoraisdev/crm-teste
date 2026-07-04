"use client";

import { useEffect, useState } from "react";
import type { LeadStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { PIPELINE_ORDER, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

export interface LeadFormValues {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: LeadStatus;
  optOut: boolean;
}

const cfInputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Formulário de lead. Sem `lead` cria um lead avulso (status NOVO); com `lead`
 * edita nome, telefone, status do pipeline e opt-out.
 */
export function LeadForm({
  lead,
  onSaved,
  labels,
}: {
  lead?: LeadFormValues;
  onSaved: () => void;
  labels?: PipelineLabels | null;
}) {
  const editing = !!lead;
  const statusMeta = resolveStatusMeta(labels);
  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "NOVO");
  const [optOut, setOptOut] = useState(lead?.optOut ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Campos customizados (só na edição: o lead precisa existir para guardar valores).
  const [cfDefs, setCfDefs] = useState<CustomFieldDefItem[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!editing || !lead) return;
    let active = true;
    (async () => {
      try {
        const [defsRes, leadRes] = await Promise.all([
          fetch("/api/custom-fields", { cache: "no-store" }),
          fetch(`/api/leads/${lead.id}`, { cache: "no-store" }),
        ]);
        const defsData = await defsRes.json().catch(() => ({}));
        const leadData = await leadRes.json().catch(() => ({}));
        if (!active) return;
        setCfDefs((defsData.defs as CustomFieldDefItem[]) ?? []);
        const cf = leadData.lead?.customFields;
        setCfValues(cf && typeof cf === "object" ? (cf as Record<string, unknown>) : {});
      } catch {
        // mantém vazio
      }
    })();
    return () => {
      active = false;
    };
  }, [editing, lead]);

  function setCf(key: string, value: unknown) {
    setCfValues((prev) => ({ ...prev, [key]: value }));
  }

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
        ? {
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            status,
            optOut,
            ...(cfDefs.length > 0 ? { customFields: cfValues } : {}),
          }
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
                  {statusMeta[s].label}
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

          {cfDefs.length > 0 && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Campos customizados
              </p>
              {cfDefs.map((d) => (
                <div key={d.id}>
                  {d.type === "BOOLEAN" ? (
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={cfValues[d.key] === true}
                        onChange={(e) => setCf(d.key, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/40"
                      />
                      {d.label}
                    </label>
                  ) : (
                    <>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        {d.label}
                      </label>
                      {d.type === "SELECT" ? (
                        <select
                          value={(cfValues[d.key] as string) ?? ""}
                          onChange={(e) => setCf(d.key, e.target.value)}
                          className={cfInputClass}
                        >
                          <option value="">—</option>
                          {(d.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"}
                          value={
                            d.type === "DATE" && typeof cfValues[d.key] === "string"
                              ? (cfValues[d.key] as string).slice(0, 10)
                              : (cfValues[d.key] as string | number) ?? ""
                          }
                          onChange={(e) => setCf(d.key, e.target.value)}
                          className={cfInputClass}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={loading}>
          {editing ? "Salvar alterações" : "Adicionar lead"}
        </Button>
      </div>
    </div>
  );
}
