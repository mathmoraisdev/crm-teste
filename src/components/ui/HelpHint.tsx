import { HelpCircle } from "lucide-react";

/**
 * Nota de ajuda "?" contextual. Usa <details>/<summary> nativo: abre por
 * clique/toque (sem depender de hover, então funciona no mobile) e não precisa
 * de JS de cliente. A instrução PRIMÁRIA deve viver fora daqui, sempre visível;
 * o HelpHint guarda só o detalhe secundário ("por que", "como").
 */
export function HelpHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group inline-block align-middle">
      <summary
        aria-label={label}
        className="inline-flex cursor-pointer list-none items-center text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden"
      >
        <HelpCircle size={14} />
      </summary>
      <div className="mt-1.5 rounded-lg border border-line-default bg-inset px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
        {children}
      </div>
    </details>
  );
}
