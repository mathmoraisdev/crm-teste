/**
 * Interface da camada WhatsApp. Os services de domínio dependem DESTA interface,
 * nunca da implementação concreta — trocar mock ↔ cloud-api é uma env var.
 */
export interface WhatsAppSendResult {
  /** ID da mensagem no provedor (usado para dedupe de webhook). */
  providerMessageId: string;
}

export interface WhatsAppService {
  readonly mode: "mock" | "cloud-api";
  /** Envia uma mensagem de texto para um número em E.164. */
  sendMessage(to: string, text: string): Promise<WhatsAppSendResult>;

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
