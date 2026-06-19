import { cn } from "@/lib/utils";

/** Marca "Disparador.ai" — quadrado verde com triângulo de "play" + wordmark. */
export function Logo({
  className,
  dark = false,
  size = "md",
}: {
  className?: string;
  /** Texto branco (sobre fundo escuro) quando true. */
  dark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const mark = size === "lg" ? "h-[34px] w-[34px]" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const text =
    size === "lg" ? "text-[21px]" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#10B981] to-[#067A52] shadow-[0_6px_16px_-6px_rgba(14,164,107,.7)]",
          mark,
        )}
      >
        <span className="ml-[2px] h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
      </span>
      <span
        className={cn(
          "font-display font-bold tracking-[-0.02em]",
          text,
          dark ? "text-white" : "text-ink",
        )}
      >
        Disparador<span className={dark ? "text-mint" : "text-brand-500"}>.ai</span>
      </span>
    </span>
  );
}
