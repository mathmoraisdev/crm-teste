import type { Prisma } from "@prisma/client";
import type { Diff } from "./diff";

/** Todas as ações auditadas. String no banco; union aqui pra segurança de tipo. */
export type AuditAction =
  | "ORDER_VOID"
  | "EXPENSE_DELETE"
  | "LEAD_DELETE"
  | "LEAD_REASSIGN"
  | "LEAD_UPDATE"
  | "OPERATOR_PERMS_UPDATE"
  | "ORDER_DISCOUNT"
  | "CATALOG_PRICE_UPDATE"
  // Agenda (Tier 2): cancelar/remarcar/trocar profissional.
  | "APPOINTMENT_CANCEL"
  | "APPOINTMENT_RESCHEDULE"
  | "APPOINTMENT_REASSIGN";

export type AuditInput = {
  accountId: string;   // dono/tenant (tenantUserId)
  actorId: string;     // sessionUserId de quem agiu (ou sentinela p/ autor não-humano)
  actorName?: string;  // nome do autor PRONTO (autor não-humano, ex.: IA); ausente = busca no User
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  diff?: Diff;
};

/**
 * Insere uma linha de auditoria DENTRO da transação recebida (`tx`).
 * IMPORTANTE: usa SÓ o `tx` — nunca o `prisma` global. Chamar o cliente global
 * dentro de uma tx aberta trava o pool de conexão (lição do agendamento).
 * Busca o nome do autor no momento (1 lookup por PK) e grava como snapshot.
 */
export async function recordAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  // Autor não-humano (IA/sistema) passa `actorName` pronto → pula o lookup no User.
  let actorName = input.actorName;
  if (actorName === undefined) {
    const actor = await tx.user.findUnique({
      where: { id: input.actorId },
      select: { name: true, email: true },
    });
    actorName = actor?.name ?? actor?.email ?? input.actorId;
  }
  await tx.auditLog.create({
    data: {
      accountId: input.accountId,
      actorId: input.actorId,
      actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      diff: input.diff as Prisma.InputJsonValue | undefined,
    },
  });
}
