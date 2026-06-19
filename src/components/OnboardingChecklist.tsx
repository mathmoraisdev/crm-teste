"use client";

import Link from "next/link";
import { Check, MessageSquare, Upload, Megaphone, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { OnboardingState } from "@/server/services/onboarding.service";

interface Step {
  done: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
}

/**
 * Checklist de primeiros passos para o novo usuário: (1) conectar WhatsApp,
 * (2) importar leads e (3) criar a primeira campanha. Cada passo vira um check
 * verde quando concluído. O card some por completo quando `state.done` — não
 * polui a tela de quem já configurou tudo.
 */
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  if (state.done) return null;

  const steps: Step[] = [
    {
      done: state.hasNumber,
      icon: MessageSquare,
      title: "Conecte um número de WhatsApp",
      description: "Pareie um chip para começar a enviar e receber mensagens.",
      href: "/campaigns",
      cta: "Conectar número",
    },
    {
      done: state.hasLeads,
      icon: Upload,
      title: "Importe seus leads",
      description: "Suba um CSV de contatos pelo botão “Importar CSV” aqui em cima.",
      href: "/leads",
      cta: "Importar CSV",
    },
    {
      done: state.hasCampaign,
      icon: Megaphone,
      title: "Crie e dispare uma campanha",
      description: "Monte a mensagem com {{nome}} e comece a falar com o funil.",
      href: "/campaigns",
      cta: "Criar campanha",
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink">Primeiros passos</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Configure sua conta para começar a vender no WhatsApp.
          </p>
        </div>
        <span className="text-xs font-bold text-slate-500">{completed} de 3</span>
      </div>

      <ol className="divide-y divide-slate-100">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
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
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
              </div>

              {!step.done && (
                <Link
                  href={step.href}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_rgba(14,164,107,.55)] transition-colors hover:bg-brand-600"
                >
                  {step.cta} <ArrowRight size={14} />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
