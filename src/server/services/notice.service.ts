import { prisma } from "@/server/db/client";
import type { AccountNoticeKind, Plan, Prisma } from "@prisma/client";

/** Snapshot mínimo da conta no momento do evento (a conta pode já não existir). */
type NoticeSnapshot = {
  accountName: string;
  accountEmail: string;
  plan: Plan | null;
};

/**
 * Registra um aviso para o admin da plataforma (cancelamento/exclusão de conta).
 * Append-only. Aceita um cliente de transação (`tx`) para gravar junto com a
 * exclusão da conta atomicamente — assim o aviso e o delete vivem ou morrem juntos.
 */
export async function recordAccountNotice(
  kind: AccountNoticeKind,
  snap: NoticeSnapshot,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.accountNotice.create({
    data: {
      kind,
      accountName: snap.accountName,
      accountEmail: snap.accountEmail,
      plan: snap.plan,
    },
    select: { id: true },
  });
}

/** Quantos avisos ainda não lidos (alimenta o badge do sidebar). */
export async function countUnseenNotices(): Promise<number> {
  return prisma.accountNotice.count({ where: { seenAt: null } });
}

/** Marca todos os avisos não lidos como vistos (chamado quando o admin abre o /financeiro). */
export async function markNoticesSeen(): Promise<void> {
  await prisma.accountNotice.updateMany({
    where: { seenAt: null },
    data: { seenAt: new Date() },
  });
}

/** Últimos avisos (lidos e não lidos) para o card do /financeiro. */
export async function listRecentNotices(limit = 30) {
  return prisma.accountNotice.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Remove avisos de CANCELAMENTO ainda não lidos de uma conta — usado quando o dono
 * REATIVA a assinatura antes de o admin ter visto. Evita alarme falso no badge.
 */
export async function clearUnseenCancelNotices(accountEmail: string): Promise<void> {
  await prisma.accountNotice.deleteMany({
    where: { accountEmail, kind: "CANCELAMENTO", seenAt: null },
  });
}
