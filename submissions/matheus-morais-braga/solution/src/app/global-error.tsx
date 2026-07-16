"use client";

import { useEffect } from "react";
import { capture } from "@/lib/analytics";

/**
 * Error boundary global — captura erros que quebram o próprio `layout.tsx`.
 *
 * Como substitui o layout raiz, precisa renderizar suas próprias tags
 * `<html>`/`<body>`. Mantemos o estilo inline para não depender de nada que o
 * layout normalmente fornece. Registra no console e no analytics (no-op sem
 * PostHog).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[erro_app_global]", error);
    capture("erro_app", {
      message: error.message,
      digest: error.digest,
      global: true,
    });
    // TODO(Sentry): se process.env.SENTRY_DSN existir, reportar o erro aqui.
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#F4F7F5",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#0A1410",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Algo deu errado
        </h1>
        <p
          style={{
            marginTop: "0.5rem",
            maxWidth: "28rem",
            fontSize: "0.875rem",
            color: "#46544D",
          }}
        >
          Tivemos um problema inesperado. Tente novamente — se continuar,
          atualize a página em alguns instantes.
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "1.5rem",
            borderRadius: "0.75rem",
            border: "none",
            backgroundColor: "#0EA46B",
            padding: "0.625rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Tentar novamente
        </button>
      </body>
    </html>
  );
}
