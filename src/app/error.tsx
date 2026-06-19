"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { capture } from "@/lib/analytics";

/**
 * Error boundary do App Router (segmento raiz).
 *
 * Mostra uma tela amigável em pt-BR e registra o erro no console e no analytics
 * (no-op sem PostHog). O `<html>`/`<body>` continuam vindo do `layout.tsx`, por
 * isso aqui renderizamos só o conteúdo. Erros que quebram o próprio layout são
 * tratados pelo `global-error.tsx`.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[erro_app]", error);
    capture("erro_app", { message: error.message, digest: error.digest });
    // TODO(Sentry): se process.env.SENTRY_DSN existir, reportar o erro aqui.
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        Algo deu errado
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        Tivemos um problema inesperado ao carregar esta página. Tente novamente
        — se continuar, atualize a página em alguns instantes.
      </p>
      <button
        onClick={() => reset()}
        className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(14,164,107,.55)] transition-colors hover:bg-brand-600"
      >
        <RotateCcw size={16} /> Tentar novamente
      </button>
    </div>
  );
}
