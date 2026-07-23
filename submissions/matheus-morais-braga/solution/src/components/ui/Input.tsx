import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Campo padronizado (input/select) — encapsula o estilo antes repetido inline
 * (`rounded-lg border border-slate-300 bg-white …`) já em tokens temáveis.
 * Adoção incremental: use onde fizer sentido, sem varrer todos os campos de uma vez.
 */
const fieldClass =
  "w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink " +
  "placeholder:text-slate-400 transition-colors " +
  "focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldClass, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(fieldClass, "pr-8", className)} {...props} />;
  },
);
