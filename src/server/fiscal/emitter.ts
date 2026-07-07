import type { FiscalProvider, FiscalEnv } from "@prisma/client";
import { focusNfeEmitter } from "./focus-nfe";
import { mockFiscalEmitter } from "./mock";
import { env } from "@/lib/env";

/** Item da nota (valores em centavos internamente; a borda converte p/ reais). */
export interface NfceItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  ncm?: string | null;
  cfop?: string | null;
}

export interface EmitNfceInput {
  apiKey: string;
  fiscalEnv: FiscalEnv;
  serie: number;
  cnpj?: string | null;
  externalReference: string; // = order.id (o emissor deduplica por ref)
  items: NfceItem[];
  totalCents: number;
  customerName?: string | null;
  customerTaxId?: string | null; // CPF na nota (opcional)
  defaultNcm?: string | null;
  defaultCfop?: string | null;
}

/** Resultado normalizado — o mesmo shape p/ emitir e p/ consultar status. */
export interface NfceResult {
  status: "PROCESSANDO" | "EMITIDA" | "ERRO";
  docId?: string;
  accessKey?: string;
  danfeUrl?: string;
  error?: string;
}

export interface FiscalEmitter {
  /** Validação barata da credencial (usado ao salvar o token). */
  verifyCredential(apiKey: string, fiscalEnv: FiscalEnv): Promise<boolean>;
  /** Emite a NFC-e. Pode voltar PROCESSANDO (SEFAZ assíncrono) → resolve depois. */
  emitNfce(input: EmitNfceInput): Promise<NfceResult>;
  /** Consulta o status atual pelo docId (fonte de verdade). */
  getStatus(apiKey: string, fiscalEnv: FiscalEnv, docId: string): Promise<NfceResult>;
  /** Cancela (best-effort; janela legal curta). Opcional no v1. */
  cancelNfce(
    apiKey: string,
    fiscalEnv: FiscalEnv,
    docId: string,
    reason: string,
  ): Promise<NfceResult>;
}

/** Converte centavos → "reais.cc" (string, sem símbolo) p/ o payload do emissor. */
export function centsToReaisString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fiscalEmitterFor(provider: FiscalProvider): FiscalEmitter {
  // FISCAL_MOCK força o emissor determinístico em dev/teste (sem tocar SEFAZ).
  if (env.FISCAL_MOCK) return mockFiscalEmitter;
  switch (provider) {
    case "FOCUS_NFE":
      return focusNfeEmitter;
    // PLUGNOTAS/TECNOSPEED: adaptadores futuros; por ora caem no não-implementado.
    default:
      throw new Error("Emissor fiscal ainda não suportado.");
  }
}
