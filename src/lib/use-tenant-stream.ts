"use client";

import { useEffect, useRef } from "react";

export interface TenantStreamEvent {
  type: string;
  leadId?: string;
}

/**
 * Assina o SSE da conta (`/api/stream`) e chama `onEvent` a cada evento de
 * mudança — substitui o polling agressivo por revalidação dirigida.
 *
 * Degradação: se não há Redis no servidor a rota responde 503 e o EventSource
 * encerra sem reconectar (regra do protocolo p/ status != 200), então o polling
 * de fallback do componente assume. Quedas de rede (após 200) reconectam sozinhas.
 */
export function useTenantStream(onEvent: (e: TenantStreamEvent) => void): void {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    // EventSource só existe no browser.
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/stream");
      es.onmessage = (ev) => {
        try {
          cbRef.current(JSON.parse(ev.data) as TenantStreamEvent);
        } catch {
          // mensagem malformada: ignora (heartbeats são comentários, não disparam onmessage)
        }
      };
      // onerror: 503 (sem Redis) encerra sem reconectar; quedas reconectam sozinhas.
    } catch {
      // ambiente sem EventSource: segue só com polling
    }
    return () => es?.close();
  }, []);
}
