import type { FiscalStatus } from "@prisma/client";

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
