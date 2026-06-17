import type { WhatsAppService } from "./types";

/**
 * Implementação mock: apenas loga no terminal e devolve um id sintético.
 * A persistência da mensagem OUTBOUND é feita pela camada de serviço
 * (messaging.ts), então o mock não toca no banco — fica simples e testável.
 */
let counter = 0;

export function createMockWhatsApp(): WhatsAppService {
  return {
    mode: "mock",
    async sendMessage(to, text) {
      const providerMessageId = `mock-out-${Date.now()}-${++counter}`;
      console.log(`[whatsapp:mock] → ${to}\n   ${text}`);
      return { providerMessageId };
    },
  };
}
