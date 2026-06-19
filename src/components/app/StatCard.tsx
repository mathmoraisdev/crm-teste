import { cn } from "@/lib/utils";

/**
 * Cartão de métrica do dashboard. Três variantes: padrão (branco), `accent`
 * (número verde) e `dark` (painel verde-escuro com número mint).
 */
export function StatCard({
  label,
  value,
  hint,
  accent = false,
  dark = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
  dark?: boolean;
}) {
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
      {hint && (
        <div
          className={cn(
            "mt-1 text-xs font-semibold",
            dark ? "text-[#8FB6A5]" : "text-slate-500",
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
