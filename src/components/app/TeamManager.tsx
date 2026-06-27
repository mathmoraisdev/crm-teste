"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import type { Plan } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/utils";

interface Member {
  id: string;
  name: string;
  email: string;
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
        body: JSON.stringify({ name, email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Falha ao criar usuário.");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
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
          <input
            className={inputCls}
            type="password"
            placeholder="Senha (mín. 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!canCreate || busy}
            minLength={8}
            required
          />
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
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    {m.name}
                    <Badge tone="slate">operador</Badge>
                  </div>
                  <div className="text-xs text-slate-400">
                    {m.email} · desde {formatDateTime(m.createdAt)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setToRemove(m)}>
                  <Trash2 size={15} /> Remover
                </Button>
              </div>
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
