import type { WhatsAppService } from "../types";

/**
 * Adapter fino: a interface genérica NÃO conhece "número". O roteamento
 * multi-número é feito no worker/messaging (que sabe escolher o chip e chamar
 * o pool). Este adapter existe só p/ o factory; envio direto sem número
 * selecionado não é suportado e falha alto (sinaliza erro de fluxo).
 */
export function createBaileysWhatsApp(): WhatsAppService {
  const err = () => {
    throw new Error(
      "Baileys é multi-número: use o caminho do worker (selectNumber + pool.send), não getWhatsApp().sendMessage direto.",
    );
  };
  return {
    mode: "baileys",
    async sendMessage() {
      return err();
    },
    async sendMedia() {
      return err();
    },
    async sendTemplate() {
      return err();
    },
  };
}
