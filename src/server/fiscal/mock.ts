import type { FiscalEmitter, EmitNfceInput, NfceResult } from "./emitter";

/**
 * Emissor fiscal determinístico (dev/teste). NÃO toca SEFAZ nem faz HTTP.
 * Ligado por env.FISCAL_MOCK. Usado pelo E2E e para exercitar o caminho de erro
 * sem depender do emissor real.
 */
export const mockFiscalEmitter: FiscalEmitter = {
  async verifyCredential(apiKey: string): Promise<boolean> {
    return apiKey.trim().length >= 12;
  },

  async emitNfce(input: EmitNfceInput): Promise<NfceResult> {
    // Item sem preço → ERRO (exercita o caminho de rejeição no E2E).
    if (input.items.some((it) => !it.unitPriceCents || it.unitPriceCents <= 0)) {
      return { status: "ERRO", error: "Item sem preço (mock)." };
    }
    return {
      status: "EMITIDA",
      docId: `mock-${input.externalReference}`,
      accessKey: "0".repeat(44),
      danfeUrl: `https://exemplo/danfe/${input.externalReference}`,
    };
  },

  async getStatus(_apiKey, _fiscalEnv, docId): Promise<NfceResult> {
    return {
      status: "EMITIDA",
      docId,
      accessKey: "0".repeat(44),
      danfeUrl: `https://exemplo/danfe/${docId}`,
    };
  },

  async cancelNfce(_apiKey, _fiscalEnv, docId): Promise<NfceResult> {
    return { status: "EMITIDA", docId }; // status "EMITIDA" = cancelamento aceito (mock)
  },
};
