/**
 * Interface da camada WhatsApp. Os services de domínio dependem DESTA interface,
 * nunca da implementação concreta — trocar mock ↔ cloud-api é uma env var.
 */
export interface WhatsAppSendResult {
  /** ID da mensagem no provedor (usado para dedupe de webhook). */
  providerMessageId: string;
  /** Qual número enviou (só Baileys multi-número preenche). */
  whatsAppNumberId?: string;
}

/** Anexo de saída (imagem/documento/áudio) enviado pelo operador pela inbox. */
export interface WhatsAppMediaPayload {
  buffer: Buffer;
  mediaType: "image" | "document" | "audio";
  mime: string;
  /** nome do arquivo (obrigatório p/ documento; ignorado em imagem/áudio). */
  fileName?: string;
  /** legenda opcional (imagem/documento; áudio não suporta legenda). */
  caption?: string;
}

export interface WhatsAppService {
  readonly mode: "mock" | "cloud-api" | "baileys";
  /** Envia uma mensagem de texto para um número em E.164. */
  sendMessage(to: string, text: string): Promise<WhatsAppSendResult>;

  /** Envia um anexo (imagem/documento/áudio) para um número em E.164. */
  sendMedia(to: string, media: WhatsAppMediaPayload): Promise<WhatsAppSendResult>;

  /**
   * Envia um template aprovado (obrigatório p/ mensagem ativa fora da janela 24h).
   * `variables` preenche os {{1}}, {{2}}... do corpo do template, na ordem.
   */
  sendTemplate(
    to: string,
    templateName: string,
    lang: string,
    variables: string[],
  ): Promise<WhatsAppSendResult>;
}
