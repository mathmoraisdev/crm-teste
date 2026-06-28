"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Trash2, UserPlus } from "lucide-react";
import type { Plan } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/utils";

type LeadsScope = "ALL" | "ASSIGNED";

interface Member {
  id: string;
  name: string;
  email: string;
  canCampaigns: boolean;
  canSettings: boolean;
  leadsScope: LeadsScope;
  createdAt: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-brand-400";

export function TeamManager({
  owner,
  members,
  plan,
  planLabel,
  seatsUsed,
  maxSeats,
}: {
  owner: { name: string; email: string };
  members: Member[];
  plan: Plan | null;
  planLabel: string;
  seatsUsed: number;
  maxSeats: number | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Permissões do novo operador (default = acesso total, igual ao comportamento atual).
  const [canCampaigns, setCanCampaigns] = useState(true);
  const [canSettings, setCanSettings] = useState(true);
  const [leadsScope, setLeadsScope] = useState<LeadsScope>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Member | null>(null);

  const noPlan = !plan;
  const full = maxSeats != null && seatsUsed >= maxSeats;
  const canCreate = !noPlan && !full;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, canCampaigns, canSettings, leadsScope }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Falha ao criar usuário.");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setCanCampaigns(true);
      setCanSettings(true);
      setLeadsScope("ALL");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Falha ao remover.");
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">
              Plano {planLabel}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {maxSeats != null
                ? `${seatsUsed} de ${maxSeats} usuários (inclui você).`
                : "Defina um plano no financeiro para liberar usuários."}
            </p>
          </div>
          {maxSeats != null && (
            <Badge tone={full ? "amber" : "green"}>
              {seatsUsed}/{maxSeats}
            </Badge>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-bold text-ink">Adicionar operador</p>
        {noPlan && (
          <p className="mb-3 rounded-md bg-[#FEF3E2] px-3 py-2 text-sm text-[#B97309]">
            Defina um plano para esta conta no Financeiro antes de adicionar usuários.
          </p>
        )}
        {full && !noPlan && (
          <p className="mb-3 rounded-md bg-[#FEF3E2] px-3 py-2 text-sm text-[#B97309]">
            Limite de usuários do plano atingido ({maxSeats}). Faça upgrade para adicionar mais.
          </p>
        )}
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <input
            className={inputCls}
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canCreate || busy}
            required
          />
          <input
            className={inputCls}
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!canCreate || busy}
            required
          />
          <div className="relative">
            <input
              className={`${inputCls} pr-11`}
              type={showPassword ? "text" : "password"}
              placeholder="Senha (mín. 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!canCreate || busy}
              minLength={8}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 transition-colors hover:text-brand-500 disabled:opacity-50"
              disabled={!canCreate || busy}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Limitações do operador */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:col-span-3">
            <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              Permissões deste operador
            </p>
            <div className="flex flex-col gap-2.5">
              <PermCheckbox
                label="Disparar campanhas"
                hint="Criar e iniciar campanhas de WhatsApp."
                checked={canCampaigns}
                onChange={setCanCampaigns}
                disabled={!canCreate || busy}
              />
              <PermCheckbox
                label="Editar configurações e IA"
                hint="Chave de IA, rótulos do funil e ajustes da conta."
                checked={canSettings}
                onChange={setCanSettings}
                disabled={!canCreate || busy}
              />
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-ink">Acesso aos leads</span>
                <select
                  className={inputCls}
                  value={leadsScope}
                  onChange={(e) => setLeadsScope(e.target.value as LeadsScope)}
                  disabled={!canCreate || busy}
                >
                  <option value="ALL">Todos os leads da conta</option>
                  <option value="ASSIGNED">Apenas os leads atribuídos a ele</option>
                </select>
              </label>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-3">
              {error}
            </p>
          )}
          <div className="sm:col-span-3">
            <Button type="submit" loading={busy} disabled={!canCreate}>
              <UserPlus size={16} /> Adicionar usuário
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-ink">
                {owner.name}
                <Badge tone="blue">admin</Badge>
              </div>
              <div className="text-xs text-slate-400">{owner.email}</div>
            </div>
            <span className="text-xs text-slate-400">você</span>
          </div>
          {members.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Nenhum operador ainda.
            </div>
          ) : (
            members.map((m) => (
              <MemberRow key={m.id} member={m} onRemove={() => setToRemove(m)} />
            ))
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={toRemove !== null}
        title="Remover operador"
        message={
          <>
            Remover <strong>{toRemove?.name}</strong>? Ele perde o acesso imediatamente. Os
            dados da conta (leads, conversas) permanecem.
          </>
        }
        confirmLabel="Remover"
        onConfirm={async () => {
          if (toRemove) await remove(toRemove.id);
        }}
        onClose={() => setToRemove(null)}
      />
    </div>
  );
}

/** Linha de operador com edição inline das permissões (PATCH ao alterar). */
function MemberRow({ member, onRemove }: { member: Member; onRemove: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(patch: Partial<Pick<Member, "canCampaigns" | "canSettings" | "leadsScope">>) {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Falha ao salvar.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <span className="break-all">{member.name}</span>
            <Badge tone="slate">operador</Badge>
          </div>
          <div className="break-all text-xs text-slate-400">
            {member.email} · desde {formatDateTime(member.createdAt)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="self-start sm:self-auto"
          onClick={onRemove}
        >
          <Trash2 size={15} /> Remover
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <PermCheckbox
          label="Disparar campanhas"
          checked={member.canCampaigns}
          onChange={(v) => patch({ canCampaigns: v })}
          disabled={saving}
        />
        <PermCheckbox
          label="Editar configurações e IA"
          checked={member.canSettings}
          onChange={(v) => patch({ canSettings: v })}
          disabled={saving}
        />
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">Leads:</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-400 disabled:opacity-50"
            value={member.leadsScope}
            onChange={(e) => patch({ leadsScope: e.target.value as LeadsScope })}
            disabled={saving}
          >
            <option value="ALL">Todos da conta</option>
            <option value="ASSIGNED">Só os atribuídos a ele</option>
          </select>
        </label>
        {err && <p className="text-xs font-medium text-red-600">{err}</p>}
      </div>
    </div>
  );
}

function PermCheckbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-brand-500 accent-brand-500 disabled:opacity-50"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}
