"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import type { CommissionRuleDTO } from "@/server/services/commission.service";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

interface ProfessionalOption { id: string; name: string }
interface ServiceOption { id: string; name: string }

type RuleType = "percent" | "fixed";

/** Formata o valor de uma regra para exibição: "40%" ou "R$ 10,00/un". */
function ruleValueLabel(r: CommissionRuleDTO): string {
  if (r.percentBps != null) return `${(r.percentBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (r.fixedCents != null) return `${formatCentsBRL(r.fixedCents)}/un`;
  return "—";
}

/**
 * CRUD de regras de comissão por profissional (dado de DONO). A UI resolve % ↔
 * percentBps e R$ ↔ fixedCents na borda; o backend guarda pontos-base/centavos.
 * Regra padrão (todos os serviços) vence nada; a específica do serviço vence a
 * padrão no cálculo do fechamento. Só tokens/CSS vars.
 */
export function CommissionSettings({ canEdit = true }: { canEdit?: boolean }) {
  const [rules, setRules] = useState<CommissionRuleDTO[]>([]);
  const [pros, setPros] = useState<ProfessionalOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [professionalId, setProfessionalId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState(""); // "" = padrão (todos)
  const [ruleType, setRuleType] = useState<RuleType>("percent");
  const [value, setValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, prosRes, catRes] = await Promise.all([
        fetch("/api/commissions/rules", { cache: "no-store" }),
        fetch("/api/professionals?activeOnly=true", { cache: "no-store" }),
        fetch("/api/vendas/catalog", { cache: "no-store" }),
      ]);
      if (rulesRes.ok) setRules(((await rulesRes.json()).rules as CommissionRuleDTO[]) ?? []);
      if (prosRes.ok) setPros((((await prosRes.json()).professionals as ProfessionalOption[]) ?? []).map((p) => ({ id: p.id, name: p.name })));
      if (catRes.ok) {
        const items = ((await catRes.json()).items as Array<ServiceOption & { active: boolean }>) ?? [];
        setServices(items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name })));
      }
    } catch {
      // mantém estado anterior
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Regras agrupadas por profissional (padrão primeiro, depois serviços por nome).
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rules: CommissionRuleDTO[] }>();
    for (const r of rules) {
      const cur = map.get(r.professionalId) ?? { name: r.professionalName, rules: [] };
      cur.rules.push(r);
      map.set(r.professionalId, cur);
    }
    for (const g of map.values()) {
      g.rules.sort((a, b) => {
        if (!a.catalogItemId && b.catalogItemId) return -1;
        if (a.catalogItemId && !b.catalogItemId) return 1;
        return (a.serviceName ?? "").localeCompare(b.serviceName ?? "");
      });
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rules]);

  function resetForm() {
    setAdding(false);
    setProfessionalId("");
    setCatalogItemId("");
    setRuleType("percent");
    setValue("");
    setError(null);
  }

  async function save() {
    setError(null);
    if (!professionalId) {
      setError("Escolha o profissional.");
      return;
    }
    const payload: Record<string, unknown> = {
      professionalId,
      catalogItemId: catalogItemId || null,
    };
    if (ruleType === "percent") {
      // "40" | "40,5" → percentBps (4000 | 4050). Resolve % → pontos-base na borda.
      const pct = parseFloat(value.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setError("Percentual entre 1 e 100.");
        return;
      }
      payload.percentBps = Math.round(pct * 100);
    } else {
      const cents = parseBRLToCents(value);
      if (cents == null || cents <= 0) {
        setError("Valor fixo inválido.");
        return;
      }
      payload.fixedCents = cents;
    }
    const res = await fetch("/api/commissions/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao salvar regra");
      return;
    }
    resetForm();
    await load();
  }

  async function remove(r: CommissionRuleDTO) {
    const res = await fetch(`/api/commissions/rules/${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Falha ao remover regra");
      return;
    }
    await load();
  }

  const noProfessionals = !loading && pros.length === 0;

  return (
    <Card>
      <CardHeader
        title="Comissões"
        subtitle="Quanto cada profissional ganha sobre o que atende. A regra de um serviço específico vence a regra padrão do profissional."
        action={
          canEdit &&
          !adding &&
          !noProfessionals && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Adicionar
            </Button>
          )
        }
      />
      <div className="space-y-2 px-4 py-3">
        {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        {noProfessionals && (
          <p className="py-4 text-center text-sm text-slate-400">
            Cadastre um profissional para definir comissões.
          </p>
        )}

        {adding && (
          <div className="space-y-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Profissional</label>
                <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={inputClass}>
                  <option value="">Selecione…</option>
                  {pros.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Serviço</label>
                <select value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)} className={inputClass}>
                  <option value="">Todos os serviços (padrão)</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
                <select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)} className={inputClass}>
                  <option value="percent">Percentual (%)</option>
                  <option value="fixed">Valor fixo (R$/un)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {ruleType === "percent" ? "Percentual" : "Valor por unidade"}
                </label>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={ruleType === "percent" ? "Ex.: 40" : "Ex.: 10,00"}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar</Button>
              <Button size="sm" onClick={save}>Salvar</Button>
            </div>
          </div>
        )}

        {loading && rules.length === 0 && !noProfessionals && (
          <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
        )}
        {!loading && rules.length === 0 && !adding && !noProfessionals && (
          <p className="py-4 text-center text-sm text-slate-400">Nenhuma regra de comissão ainda.</p>
        )}

        {grouped.map((g) => (
          <div key={g.id} className="rounded-lg border border-line-default">
            <div className="border-b border-line-default px-3 py-2 text-sm font-semibold text-ink">{g.name}</div>
            <ul className="divide-y divide-line-default">
              {g.rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {r.catalogItemId ? (
                      <span className="truncate text-sm text-ink">{r.serviceName}</span>
                    ) : (
                      <Badge tone="slate">Padrão (todos os serviços)</Badge>
                    )}
                    <span className="shrink-0 text-sm font-medium text-brand-600">{ruleValueLabel(r)}</span>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => remove(r)}>Remover</Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
