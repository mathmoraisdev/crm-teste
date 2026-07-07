import type { FiscalStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { decryptSecret } from "@/server/crypto";
import { fiscalEmitterFor, type EmitNfceInput, type NfceResult } from "@/server/fiscal/emitter";
import { orderTotalCents } from "./order.service";
import { logger } from "@/lib/logger";

export type FiscalAction = "EMITIR" | "CONSULTAR" | "DESISTIR" | "NADA";

/** Decide o próximo passo do worker para uma comanda fiscal. Puro e testável. */
export function nextFiscalAction(
  o: { status: FiscalStatus; attempts: number },
  maxAttempts: number,
): FiscalAction {
  switch (o.status) {
    case "PENDENTE":
      return "EMITIR";
    case "PROCESSANDO":
      return "CONSULTAR";
    case "ERRO":
      return o.attempts >= maxAttempts ? "DESISTIR" : "EMITIR";
    case "EMITIDA":
    case "CANCELADA":
      return "NADA";
    default:
      return "NADA";
  }
}

/** Grava o resultado normalizado do emissor na comanda. */
async function applyResult(orderId: string, r: NfceResult): Promise<void> {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      fiscalStatus: r.status, // "EMITIDA" | "ERRO" | "PROCESSANDO"
      fiscalDocId: r.docId ?? undefined,
      fiscalKey: r.accessKey ?? undefined,
      fiscalDanfeUrl: r.danfeUrl ?? undefined,
      fiscalError: r.status === "ERRO" ? (r.error ?? "Rejeitada pelo emissor.") : null,
      fiscalIssuedAt: r.status === "EMITIDA" ? new Date() : undefined,
    },
  });
}

/**
 * Drena as comandas fiscais pendentes/processando das contas opt-in. Retorna
 * quantas resolveu. Gated pelo kill-switch global FISCAL_EMISSION (2ª chave é o
 * opt-in por conta). Idempotente: o flip atômico PENDENTE→PROCESSANDO garante que
 * só um worker/tick emite cada comanda; externalReference=order.id deduplica no
 * emissor mesmo se dois ticks passarem. Nunca loga o token.
 */
export async function dispatchPendingFiscalEmissions(_now: Date): Promise<number> {
  if (!env.FISCAL_EMISSION) return 0; // kill-switch global
  const orders = await prisma.order.findMany({
    where: {
      fiscalStatus: { in: ["PENDENTE", "PROCESSANDO"] },
      account: { fiscalEnabled: true, fiscalProvider: { not: null }, fiscalKeyEnc: { not: null } },
    },
    include: {
      items: true,
      account: {
        select: {
          fiscalProvider: true, fiscalKeyEnc: true, fiscalEnv: true, fiscalSerie: true,
          fiscalCnpj: true, fiscalDefaultNcm: true, fiscalDefaultCfop: true,
        },
      },
    },
    take: 25, // lote pequeno; o throttle do worker repete
  });

  let done = 0;
  for (const o of orders) {
    const a = o.account;
    const emitter = fiscalEmitterFor(a.fiscalProvider!);
    const apiKey = decryptSecret(a.fiscalKeyEnc!);
    try {
      if (o.fiscalStatus === "PENDENTE") {
        // Flip atômico: só um worker/tick emite esta comanda (evita nota em dobro).
        const claimed = await prisma.order.updateMany({
          where: { id: o.id, fiscalStatus: "PENDENTE" },
          data: { fiscalStatus: "PROCESSANDO", fiscalAttempts: { increment: 1 } },
        });
        if (claimed.count === 0) continue; // outro tick pegou
        const total = orderTotalCents({
          items: o.items, discountCents: o.discountCents,
          surchargeCents: o.surchargeCents, tipCents: o.tipCents,
        });
        const input: EmitNfceInput = {
          apiKey, fiscalEnv: a.fiscalEnv, serie: a.fiscalSerie, cnpj: a.fiscalCnpj,
          externalReference: o.id, totalCents: total,
          items: o.items.map((it) => ({
            name: it.nameSnapshot, quantity: it.quantity, unitPriceCents: it.unitPriceCents,
          })),
          customerName: o.customerName, defaultNcm: a.fiscalDefaultNcm, defaultCfop: a.fiscalDefaultCfop,
        };
        const r = await emitter.emitNfce(input);
        await applyResult(o.id, r);
      } else {
        // PROCESSANDO: re-consulta o emissor (SEFAZ resolveu?).
        if (!o.fiscalDocId) continue;
        const r = await emitter.getStatus(apiKey, a.fiscalEnv, o.fiscalDocId);
        await applyResult(o.id, r);
      }
      done++;
    } catch (err) {
      // Nunca logar o token. Falha de rede → volta a PENDENTE p/ o próximo tick tentar.
      logger.error({ orderId: o.id, err }, "[worker] emissão fiscal falhou");
      await prisma.order.updateMany({
        where: { id: o.id, fiscalStatus: "PROCESSANDO" },
        data: { fiscalStatus: "PENDENTE" },
      });
    }
  }
  return done;
}
