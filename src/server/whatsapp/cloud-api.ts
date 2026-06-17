import { env } from "@/lib/env";
import type { WhatsAppService } from "./types";

/**
 * Implementação real via WhatsApp Cloud API (Meta Graph API).
 * Pronta e selecionável por env (WHATSAPP_MODE=cloud-api), sem SDK extra.
 * As credenciais são validadas de forma preguiçosa aqui — não no boot — para
 * o app subir só com a chave da Anthropic no modo mock.
 */
const GRAPH_VERSION = "v21.0";

export function createCloudWhatsApp(): WhatsAppService {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error(
      "WHATSAPP_MODE=cloud-api exige WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no .env",
    );
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  return {
    mode: "cloud-api",
    async sendMessage(to, text) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/^\+/, ""), // Graph API espera sem o "+"
          type: "text",
          text: { preview_url: false, body: text },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp Cloud API ${res.status}: ${detail}`);
      }

      const data = (await res.json()) as {
        messages?: { id: string }[];
      };
      return {
        providerMessageId: data.messages?.[0]?.id ?? `cloud-${Date.now()}`,
      };
    },

    async sendTemplate(to, templateName, lang, variables) {
      const components =
        variables.length > 0
          ? [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ]
          : [];
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/^\+/, ""),
          type: "template",
          template: {
            name: templateName,
            language: { code: lang },
            components,
          },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp Cloud API (template) ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { messages?: { id: string }[] };
      return { providerMessageId: data.messages?.[0]?.id ?? `cloud-tpl-${Date.now()}` };
    },
  };
}
