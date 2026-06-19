"use client";

import { useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";

/**
 * Inicializa o analytics de produto (PostHog) no mount e renderiza os filhos.
 *
 * Sem `NEXT_PUBLIC_POSTHOG_KEY`, o `initAnalytics()` é no-op — então este
 * provider apenas renderiza `children` e nada é carregado.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  return <>{children}</>;
}
