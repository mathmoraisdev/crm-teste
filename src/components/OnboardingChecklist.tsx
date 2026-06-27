"use client";

import Link from "next/link";
import {
  Check,
  MessageSquare,
  Upload,
  Megaphone,
  Bot,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type {
  OnboardingState,
  OnboardingStepKey,
} from "@/server/services/onboarding.service";

/**
 * Apresentação (ícone/título/descrição/CTA) por passo, indexada pela `key`. A
 * ordem de render segue `state.steps`, que já vem filtrado e ordenado pelo
 * service conforme o plano do dono.
 */
const STEP_META: Record<
  OnboardingStepKey,
  { icon: LucideIcon; title: string; description: string; href: string; cta: string }
> = {
  number: {
    icon: MessageSquare,
    title: "Conecte um número de WhatsApp",
    description: "Pareie um chip para começar a enviar e receber mensagens.",
    href: "/empresas",
    cta: "Conectar número",
  },
  leads: {
    icon: Upload,
    title: "Importe seus leads",
    description: "Suba um CSV de contatos pelo botão “Importar CSV” aqui em cima.",
    href: "/leads",
    cta: "Importar CSV",
  },
  ai: {
    icon: Bot,
    title: "Configure a IA de atendimento",
    description: "Conecte sua chave para a IA qualificar leads automaticamente.",
    href: "/configuracoes",
    cta: "Configurar IA",
  },
  campaign: {
    icon: Megaphone,
    title: "Crie e dispare uma campanha",
    description: "Monte a mensagem com {{nome}} e comece a falar com o funil.",
    href: "/campaigns",
    cta: "Criar campanha",
  },
  meeting: {
    icon: CalendarClock,
    title: "Agende sua primeira reunião",
    description: "Marque um agendamento na Agenda — o lead recebe lembrete no WhatsApp.",
    href: "/agenda",
    cta: "Abrir agenda",
  },
};

/**
 * Checklist de primeiros passos, ciente do plano. Renderiza só os passos
 * aplicáveis (`state.steps`, vindos do service) e marca cada um como check verde
 * quando concluído. O card some por completo quando `state.done` — não polui a
 * tela de quem já configurou tudo.
 */
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  if (state.done) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink">Primeiros passos</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Configure sua conta para começar a vender no WhatsApp.
          </p>
        </div>
        <span className="text-xs font-bold text-slate-500">
          {state.completed} de {state.total}
        </span>
      </div>

      <ol className="divide-y divide-slate-100">
        {state.steps.map((step) => {
          const meta = STEP_META[step.key];
          const Icon = meta.icon;
          return (
            <li
              key={step.key}
              className="flex items-center gap-4 px-5 py-4"
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  step.done
                    ? "bg-brand-500 text-white"
                    : "bg-[#EBF0ED] text-slate-500",
                )}
              >
                {step.done ? <Check size={18} /> : <Icon size={17} />}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-bold",
                    step.done ? "text-slate-400 line-through" : "text-ink",
                  )}
                >
                  {meta.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{meta.description}</p>
              </div>

              {!step.done && (
                <Link
                  href={meta.href}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_rgba(14,164,107,.55)] transition-colors hover:bg-brand-600"
                >
                  {meta.cta} <ArrowRight size={14} />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
