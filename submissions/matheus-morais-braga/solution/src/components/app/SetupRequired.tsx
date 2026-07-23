import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * Empty-state de "falta configurar X". Substitui a tela de uma rota cujo
 * pré-requisito duro não foi cumprido (ex.: inbox sem número). NÃO é um portão
 * global: bloqueia só a ação que não funcionaria, aponta o caminho e — para
 * quem não tem permissão — mostra um aviso passivo em vez do CTA. Fail-open por
 * design ([[reorganizacao-navegacao-feito]]).
 */
export function SetupRequired({
  icon: Icon,
  title,
  description,
  href,
  cta,
  canSettings,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  canSettings: boolean;
}) {
  return (
    <Card className="mx-auto max-w-md">
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        {Icon && (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-inset text-brand-500">
            <Icon size={22} />
          </span>
        )}
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
        {canSettings ? (
          <Link
            href={href}
            className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            {cta} <ArrowRight size={16} />
          </Link>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            Peça ao administrador da conta para concluir esta configuração.
          </p>
        )}
      </div>
    </Card>
  );
}
