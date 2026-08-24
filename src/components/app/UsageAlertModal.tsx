"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Contact,
  MessageSquare,
  Smartphone,
  TrendingUp,
  Users,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { planLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";
import type { AccountLimits } from "@/server/services/account.service";

/**
 * Alerta proativo de limites do plano — modal elegante que abre sozinho (1x por
 * sessão) quando a conta se aproxima ou atinge/excede o teto em algum recurso.
 *
 * Regras de "quando avisar":
 *  - IA e Contatos (consumo contínuo): avisa a partir de 80% ("próximo") e no/
 *    acima do teto ("atingido"/"acima") — são os que interrompem o atendimento.
 *  - Números e Usuários: só avisam se PASSAREM do teto (acima), pois "cheio" é o
 *    estado normal esperado do plano (ex.: Inicial com 1/1 usuário não é alerta).
 *
 * Guarda no sessionStorage a "assinatura" do estado atual (nível + recursos
 * flagados) pra não reexibir o MESMO alerta a cada navegação — reabre só se a
 * situação mudar (piorar/novo recurso no teto). Busca os próprios dados; some
 * silenciosamente se falhar ou não houver o que avisar.
 */
const SESSION_KEY = "usage-alert-sig";
const WARN_PCT = 80; // limite a partir do qual os recursos contínuos passam a "próximo"

type DimStatus = "near" | "at" | "over";

interface Dim {
  key: string;
  icon: React.ReactNode;
  label: string;
  used: number;
  max: number;
  unlimited: boolean;
  continuous: boolean; // IA/contatos: avisa ao aproximar; demais só se exceder
}

function pct(used: number, max: number): number {
  return max <= 0 ? 0 : Math.round((used / max) * 100);
}

function statusOf(d: Dim): DimStatus | null {
  if (d.unlimited) return null;
  if (d.used > d.max) return "over"; // acima do teto (caso anormal de migração)
  if (d.continuous && d.used >= d.max) return "at"; // no teto (bloqueia IA/contatos)
  if (d.continuous && pct(d.used, d.max) >= WARN_PCT) return "near"; // aproximando
  return null;
}

export function UsageAlertModal() {
  const router = useRouter();
  const [limits, setLimits] = useState<AccountLimits | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/limits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.limits) return;
        setLimits(d.limits as AccountLimits);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { flagged, level, signature } = useMemo<{
    flagged: (Dim & { status: DimStatus })[];
    level: null | "warning" | "danger";
    signature: string;
  }>(() => {
    if (!limits) return { flagged: [], level: null, signature: "" };
    const all: Dim[] = [
      { key: "ai", icon: <MessageSquare size={14} />, label: "Mensagens de IA/mês", used: limits.ai.used, max: limits.ai.quota, unlimited: limits.ai.unlimited, continuous: true },
      { key: "contacts", icon: <Contact size={14} />, label: "Contatos na base", used: limits.contacts.used, max: limits.contacts.max, unlimited: limits.contacts.unlimited, continuous: true },
      { key: "numbers", icon: <Smartphone size={14} />, label: "Números de WhatsApp", used: limits.numbers.used, max: limits.numbers.max, unlimited: limits.numbers.unlimited, continuous: false },
      { key: "seats", icon: <Users size={14} />, label: "Usuários", used: limits.seats.used, max: limits.seats.max, unlimited: limits.seats.unlimited, continuous: false },
    ];
    // Acumula só os flagados; `if (status)` afunila p/ DimStatus (sem null).
    const flagged: (Dim & { status: DimStatus })[] = [];
    for (const d of all) {
      const status = statusOf(d);
      if (status) flagged.push({ ...d, status });
    }
    const danger = flagged.some((f) => f.status === "over" || f.status === "at");
    const level = flagged.length === 0 ? null : danger ? "danger" : "warning";
    const keys = flagged.map((f) => f.key).sort().join(",");
    const signature = level ? `${level}:${keys}` : "";
    return { flagged, level, signature };
  }, [limits]);

  // Abre 1x por sessão para cada estado novo (assinatura); repete só se mudar.
  useEffect(() => {
    if (!signature) {
      setOpen(false);
      return;
    }
    if (sessionStorage.getItem(SESSION_KEY) !== signature) setOpen(true);
  }, [signature]);

  if (!limits || !level) return null;

  function dismiss() {
    if (signature) sessionStorage.setItem(SESSION_KEY, signature);
    setOpen(false);
  }

  const planName = planLabel(limits.plan);
  const title = planName && planName !== "—" ? `Limites do plano · ${planName}` : "Limites do plano";

  return (
    <Modal open={open} onClose={dismiss} title={title}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
            level === "danger" ? "bg-danger-surface text-danger" : "bg-warning-surface text-warning",
          )}
        >
          {level === "danger" ? <AlertTriangle size={20} /> : <TrendingUp size={20} />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-ink">
            {level === "danger" ? "Limite do plano atingido" : "Plano próximo do limite"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {level === "danger"
              ? "Você atingiu ou ultrapassou o teto do seu plano em alguns recursos. Operações afetadas podem ser bloqueadas — faça upgrade para liberar."
              : "Seu uso está se aproximando do teto. Faça upgrade a tempo para não interromper o atendimento por IA nem a entrada de novos contatos."}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {flagged.map((f) => {
          const p = pct(f.used, f.max);
          const danger = f.status === "over" || f.status === "at";
          const label =
            f.status === "over" ? "Acima do limite" : f.status === "at" ? "Limite atingido" : "Próximo do limite";
          return (
            <div key={f.key} className="flex items-center gap-3 rounded-xl border border-line bg-card p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-inset text-slate-500">
                {f.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-ink">{f.label}</span>
                  <span className="whitespace-nowrap text-xs font-bold text-ink">
                    {f.used.toLocaleString("pt-BR")}
                    <span className="font-medium text-slate-400"> / {f.max.toLocaleString("pt-BR")}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full transition-all", danger ? "bg-danger" : "bg-warning")}
                    style={{ width: `${Math.min(100, p)}%` }}
                  />
                </div>
              </div>
              <span className={cn("shrink-0 text-[11px] font-semibold", danger ? "text-danger" : "text-warning")}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="md" onClick={dismiss}>
          Lembrar depois
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            dismiss();
            router.push("/landing#precos");
          }}
        >
          Ver planos e fazer upgrade
        </Button>
      </div>
    </Modal>
  );
}
