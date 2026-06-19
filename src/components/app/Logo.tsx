import { cn } from "@/lib/utils";

/**
 * Marca "Disparador.ai" — tile verde com avião de papel de duas tonalidades
 * (disparo/envio) e uma fagulha mint (o ".ai"). SVG: nítido em qualquer tamanho
 * e legível até como favicon. A mesma arte vive em `src/app/icon.svg`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Disparador.ai"
    >
      <defs>
        <linearGradient id="disp-logo-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#12C27E" />
          <stop offset="1" stopColor="#067A52" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#disp-logo-grad)" />
      {/* avião de papel — asa superior (clara) + inferior (dobra, sombreada) */}
      <path d="M10.5 12.8 L30.2 20 L18.8 20 Z" fill="#FFFFFF" />
      <path d="M18.8 20 L30.2 20 L10.5 27.2 Z" fill="#FFFFFF" fillOpacity="0.62" />
      {/* fagulha de IA */}
      <path
        d="M30.6 7 C30.95 9.4 31.5 9.95 33.9 10.3 C31.5 10.65 30.95 11.2 30.6 13.6 C30.25 11.2 29.7 10.65 27.3 10.3 C29.7 9.95 30.25 9.4 30.6 7 Z"
        fill="#5FE3A1"
      />
    </svg>
  );
}

/** Logo completa: marca + wordmark. */
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
  const text = size === "lg" ? "text-[21px]" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("rounded-[11px] shadow-[0_6px_16px_-6px_rgba(14,164,107,.7)]", mark)}>
        <LogoMark className="h-full w-full" />
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
