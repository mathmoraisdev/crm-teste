import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cartão de métrica do dashboard. Três variantes: padrão (branco), `accent`
 * (número verde) e `dark` (painel verde-escuro com número mint).
 *
 * `delta` (fração, ex.: 0.24 = +24%) mostra a variação vs o período anterior
 * com seta e cor (verde sobe / vermelho cai). null/undefined = sem base.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  accent = false,
  dark = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number | null;
  accent?: boolean;
  dark?: boolean;
}) {
  const showDelta = delta !== null && delta !== undefined;
  const up = (delta ?? 0) >= 0;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5",
        dark ? "border-forest bg-forest" : "border-slate-200 bg-white",
      )}
    >
      {dark && (
        <span className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(95,227,161,.22),transparent_70%)]" />
      )}
      <div
        className={cn(
          "text-[12.5px] font-semibold",
          dark ? "text-[#8FB6A5]" : "text-slate-500",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-display text-[32px] font-bold tracking-[-0.02em]",
          dark ? "text-mint" : accent ? "text-brand-500" : "text-ink",
        )}
      >
        {value}
      </div>
      {(hint || showDelta) && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-xs font-semibold",
            dark ? "text-[#8FB6A5]" : "text-slate-500",
          )}
        >
          {showDelta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5",
                up ? "text-brand-600" : "text-[#C0392B]",
                dark && up && "text-mint",
              )}
            >
              {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {up ? "+" : ""}
              {Math.round((delta ?? 0) * 100)}%
            </span>
          )}
          {hint}
        </div>
      )}
    </div>
  );
}
