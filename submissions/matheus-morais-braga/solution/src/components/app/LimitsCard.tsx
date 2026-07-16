"use client";

import { useEffect, useState } from "react";
import { Contact, MessageSquare, Smartphone, Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { AccountLimits } from "@/server/services/account.service";

/** Uma métrica de teto: barra de uso + "usado / limite" (ou "Ilimitado"). */
function Meter({
  icon,
  label,
  used,
  max,
  unlimited,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  max: number;
  unlimited: boolean;
  note?: string;
}) {
  const pct = unlimited || max <= 0 ? 0 : Math.min(100, Math.round((used / max) * 100));
  // Cor da barra: verde normal, âmbar ≥80%, vermelho no teto.
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand-500";

  return (
    <div className="bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <span className="text-slate-400">{icon}</span>
          {label}
        </span>
        <span className="text-xs font-bold text-ink">
          {unlimited ? (
            <span className="text-brand-600">Ilimitado</span>
          ) : (
            <>
              {used.toLocaleString("pt-BR")}
              <span className="font-medium text-slate-400"> / {max.toLocaleString("pt-BR")}</span>
            </>
          )}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        {unlimited ? (
          <div className="h-full w-full bg-[repeating-linear-gradient(45deg,rgb(var(--slate-200)),rgb(var(--slate-200))_6px,rgb(var(--slate-100))_6px,rgb(var(--slate-100))_12px)]" />
        ) : (
          <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
        )}
      </div>
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

/**
 * Card "Limites da conta" — uso vs. teto do plano (IA, contatos, números,
 * usuários). Busca os próprios dados; some silenciosamente se falhar.
 */
export function LimitsCard() {
  const [limits, setLimits] = useState<AccountLimits | null>(null);

  useEffect(() => {
    fetch("/api/account/limits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLimits(d.limits as AccountLimits))
      .catch(() => {});
  }, []);

  if (!limits) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Limites da conta"
        subtitle={
          limits.byok
            ? "Uso vs. teto do plano · IA ilimitada (chave própria)"
            : "Uso vs. teto do plano no mês"
        }
      />
      <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
        <Meter
          icon={<MessageSquare size={14} />}
          label="Mensagens de IA/mês"
          used={limits.ai.used}
          max={limits.ai.quota}
          unlimited={limits.ai.unlimited}
          note={limits.ai.unlimited ? undefined : "reseta na virada do mês"}
        />
        <Meter
          icon={<Contact size={14} />}
          label="Contatos"
          used={limits.contacts.used}
          max={limits.contacts.max}
          unlimited={limits.contacts.unlimited}
          note="total na base"
        />
        <Meter
          icon={<Smartphone size={14} />}
          label="Números"
          used={limits.numbers.used}
          max={limits.numbers.max}
          unlimited={limits.numbers.unlimited}
        />
        <Meter
          icon={<Users size={14} />}
          label="Usuários"
          used={limits.seats.used}
          max={limits.seats.max}
          unlimited={limits.seats.unlimited}
        />
      </div>
    </Card>
  );
}
