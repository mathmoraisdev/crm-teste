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
  const mediaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`;

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

    async sendMedia(to, media) {
      // Bucket privado → não há URL pública p/ a Meta buscar. Fazemos o upload em
      // 2 etapas: (1) sobe o binário e ganha um media_id; (2) envia a mensagem
      // referenciando esse id. Áudio não aceita legenda; documento leva filename.
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", media.mime);
      form.append(
        "file",
        new Blob([new Uint8Array(media.buffer)], { type: media.mime }),
        media.fileName ?? `arquivo-${media.mediaType}`,
      );
      const upRes = await fetch(mediaUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
        body: form,
      });
      if (!upRes.ok) {
        const detail = await upRes.text().catch(() => "");
        throw new Error(`WhatsApp Cloud API (upload) ${upRes.status}: ${detail}`);
      }
      const uploaded = (await upRes.json()) as { id?: string };
      if (!uploaded.id) throw new Error("WhatsApp Cloud API (upload): resposta sem media id");

      const obj: Record<string, unknown> = { id: uploaded.id };
      if (media.caption && media.mediaType !== "audio") obj.caption = media.caption;
      if (media.mediaType === "document" && media.fileName) obj.filename = media.fileName;
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
          type: media.mediaType,
          [media.mediaType]: obj,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp Cloud API (media) ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { messages?: { id: string }[] };
      return { providerMessageId: data.messages?.[0]?.id ?? `cloud-media-${Date.now()}` };
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
