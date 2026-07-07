import type { FiscalEnv } from "@prisma/client";
import { centsToReaisString } from "./emitter";
import type { FiscalEmitter, EmitNfceInput, NfceResult } from "./emitter";

/**
 * Adaptador Focus NFe (NFC-e, modelo 65). O emissor terceiro é a fonte de verdade
 * fiscal: assinatura, CSC, contingência e cadastro tributário pesado moram nele —
 * aqui só montamos o payload e normalizamos o status.
 *
 * Auth: HTTP Basic com o token como USUÁRIO (senha vazia). Base por ambiente
 * (homologação vs produção). O token NUNCA é logado.
 *
 * Docs: https://focusnfe.com.br/doc/#nfce
 */
function base(fiscalEnv: FiscalEnv): string {
  return fiscalEnv === "PRODUCAO"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br";
}

function authHeader(apiKey: string): string {
  // Basic base64("<token>:") — token como usuário, senha vazia.
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

interface FocusNfceResponse {
  status?: string; // "processando_autorizacao" | "autorizado" | "erro_autorizacao" | "cancelado"
  chave_nfe?: string;
  caminho_danfe?: string;
  url?: string;
  mensagem_sefaz?: string;
  erros?: Array<{ mensagem?: string }> | string;
}

/** Normaliza o status do Focus p/ o shape interno (PROCESSANDO/EMITIDA/ERRO). */
function normalize(body: FocusNfceResponse, fiscalEnv: FiscalEnv): NfceResult {
  const st = body.status ?? "";
  if (st === "autorizado") {
    const danfe = body.caminho_danfe
      ? `${base(fiscalEnv)}${body.caminho_danfe}`
      : (body.url ?? undefined);
    return {
      status: "EMITIDA",
      accessKey: body.chave_nfe ?? undefined,
      danfeUrl: danfe,
    };
  }
  if (st === "processando_autorizacao") {
    return { status: "PROCESSANDO" };
  }
  // erro_autorizacao / denegado / qualquer outro → ERRO com a mensagem de rejeição.
  const erroMsg = Array.isArray(body.erros)
    ? body.erros.map((e) => e?.mensagem).filter(Boolean).join("; ")
    : typeof body.erros === "string"
      ? body.erros
      : undefined;
  return {
    status: "ERRO",
    error: body.mensagem_sefaz ?? erroMsg ?? "Rejeitada pelo emissor.",
  };
}

export const focusNfeEmitter: FiscalEmitter = {
  async verifyCredential(apiKey: string, fiscalEnv: FiscalEnv): Promise<boolean> {
    const res = await fetch(`${base(fiscalEnv)}/v2/empresas`, {
      method: "GET",
      headers: { Authorization: authHeader(apiKey) },
    });
    return res.ok;
  },

  async emitNfce(input: EmitNfceInput): Promise<NfceResult> {
    const items = input.items.map((it, i) => ({
      numero_item: i + 1,
      codigo_ncm: it.ncm ?? input.defaultNcm ?? undefined,
      cfop: it.cfop ?? input.defaultCfop ?? undefined,
      descricao: it.name,
      quantidade_comercial: it.quantity,
      quantidade_tributavel: it.quantity,
      valor_unitario_comercial: centsToReaisString(it.unitPriceCents),
      valor_unitario_tributavel: centsToReaisString(it.unitPriceCents),
      valor_bruto: centsToReaisString(it.unitPriceCents * it.quantity),
      unidade_comercial: "UN",
      unidade_tributavel: "UN",
    }));

    const payload = {
      natureza_operacao: "Venda ao consumidor",
      presenca_comprador: "1", // operação presencial
      modalidade_frete: "9", // sem frete
      cnpj_emitente: input.cnpj ?? undefined,
      nome_destinatario: input.customerName ?? undefined,
      cpf_destinatario: input.customerTaxId ?? undefined,
      valor_total: centsToReaisString(input.totalCents),
      items,
      formas_pagamento: [
        { forma_pagamento: "99", valor_pagamento: centsToReaisString(input.totalCents) },
      ],
    };

    const res = await fetch(
      `${base(input.fiscalEnv)}/v2/nfce?ref=${encodeURIComponent(input.externalReference)}`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(input.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const body = (await res.json().catch(() => ({}))) as FocusNfceResponse;
    const result = normalize(body, input.fiscalEnv);
    // A ref é a nossa chave de dedup; o docId do Focus é a própria ref.
    return { ...result, docId: input.externalReference };
  },

  async getStatus(apiKey: string, fiscalEnv: FiscalEnv, docId: string): Promise<NfceResult> {
    const res = await fetch(`${base(fiscalEnv)}/v2/nfce/${encodeURIComponent(docId)}`, {
      method: "GET",
      headers: { Authorization: authHeader(apiKey) },
    });
    const body = (await res.json().catch(() => ({}))) as FocusNfceResponse;
    return { ...normalize(body, fiscalEnv), docId };
  },

  async cancelNfce(
    apiKey: string,
    fiscalEnv: FiscalEnv,
    docId: string,
    reason: string,
  ): Promise<NfceResult> {
    const res = await fetch(`${base(fiscalEnv)}/v2/nfce/${encodeURIComponent(docId)}`, {
      method: "DELETE",
      headers: {
        Authorization: authHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ justificativa: reason }),
    });
    const body = (await res.json().catch(() => ({}))) as FocusNfceResponse;
    // "cancelado" = cancelamento aceito → sinaliza sucesso reusando "EMITIDA".
    if (res.ok && (body.status === "cancelado" || body.status === "autorizado")) {
      return { status: "EMITIDA", docId };
    }
    return {
      status: "ERRO",
      docId,
      error: body.mensagem_sefaz ?? "Falha ao cancelar a NFC-e.",
    };
  },
};
