"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-[0_8px_20px_-8px_rgba(14,164,107,.55)] hover:bg-brand-600 disabled:bg-brand-300 disabled:shadow-none",
  secondary:
    "bg-white text-ink border border-slate-300 hover:border-brand-400 hover:bg-slate-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink disabled:opacity-50",
  danger: "bg-[#E5484D] text-white hover:bg-[#C93B40] disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={size === "sm" ? 14 : 16} className="animate-spin" />}
      {children}
    </button>
  );
}
