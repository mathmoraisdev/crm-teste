import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Nota de ajuda "?" contextual. Usa <details>/<summary> nativo: abre por
 * clique/toque (sem depender de hover, então funciona no mobile) e não precisa
 * de JS de cliente. A instrução PRIMÁRIA deve viver fora daqui, sempre visível;
 * o HelpHint guarda só o detalhe secundário ("por que", "como").
 */
export function HelpHint({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  /** Lado p/ onde o overlay abre. "right" alinha à borda direita do gatilho
   *  (útil quando o "?" fica no canto direito, p/ não vazar da viewport). */
  align?: "left" | "right";
}) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        aria-label={label}
        className="inline-flex cursor-pointer list-none items-center text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden"
      >
        <HelpCircle size={14} />
      </summary>
      {/* Overlay flutuante (absolute): abre POR CIMA do conteúdo, sem empurrar/
          quebrar a linha da lista. Largura fixa com guarda de viewport no mobile. */}
      <div
        className={cn(
          "absolute top-full z-20 mt-1.5 w-64 max-w-[calc(100vw-2.5rem)] rounded-lg border border-line-default bg-inset px-3 py-2 text-xs font-normal leading-relaxed text-slate-600 shadow-lg dark:text-slate-400",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </details>
  );
}
