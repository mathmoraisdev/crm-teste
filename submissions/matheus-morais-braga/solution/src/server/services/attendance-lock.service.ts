import { prisma } from "@/server/db/client";
import { publishTenantEvent } from "@/server/events/bus";

/**
 * Trava de atendimento por conversa (anti-colisão event-driven). Substitui a
 * presença por heartbeat: escreve SÓ em transições (abrir/assumir/fechar), não num
 * timer. O "quem atende" é lido de graça na query da lista do inbox (coluna no Lead).
 * Modelo "assumir na hora": claim só pega se livre; ocupado → o front oferece Assumir.
 */

export interface LockHolder {
  userId: string;
  name: string;
  since: Date | null;
}

export interface ClaimResult {
  ok: boolean;
  /** preenchido quando ok=false: quem já está atendendo */
  heldBy: LockHolder | null;
}

/** Reivindica a trava se estiver livre (ou já for minha). Ocupada por outro → não rouba. */
export async function claimConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
  now?: Date;
}): Promise<ClaimResult> {
  const now = args.now ?? new Date();
  // updateMany condicional serializa dois operadores no mesmo tick: só um vê count=1.
  // `userId: tenantUserId` deixa a trava auto-escopada: um leadId de outra conta dá
  // count=0 (não depende do gate de posse do chamador).
  const res = await prisma.lead.updateMany({
    where: {
      id: args.leadId,
      userId: args.tenantUserId,
      OR: [{ attendingUserId: null }, { attendingUserId: args.userId }],
    },
    data: { attendingUserId: args.userId, attendingAt: now },
  });
  if (res.count === 1) {
    await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
    return { ok: true, heldBy: null };
  }
  // Ocupada por outro: devolve quem segura (pro front mostrar "Fulano está atendendo").
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, userId: args.tenantUserId },
    select: { attendingUserId: true, attendingAt: true, attendingTo: { select: { id: true, name: true } } },
  });
  const holder = lead?.attendingTo
    ? { userId: lead.attendingTo.id, name: lead.attendingTo.name, since: lead.attendingAt ?? null }
    : null;
  return { ok: false, heldBy: holder };
}

/** Assume à força (takeover). O atendente anterior é avisado pelo evento publicado. */
export async function takeoverConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
  now?: Date;
}): Promise<void> {
  // updateMany (não update) p/ poder cravar `userId: tenantUserId` no where: um leadId
  // de outra conta dá count=0 e não publica evento nem escreve nada.
  const res = await prisma.lead.updateMany({
    where: { id: args.leadId, userId: args.tenantUserId },
    data: { attendingUserId: args.userId, attendingAt: args.now ?? new Date() },
  });
  if (res.count === 1) {
    await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
  }
}

/** Libera a trava — SÓ se eu ainda for o dono (não apaga a trava de quem assumiu). */
export async function releaseConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
}): Promise<void> {
  const res = await prisma.lead.updateMany({
    where: { id: args.leadId, userId: args.tenantUserId, attendingUserId: args.userId },
    data: { attendingUserId: null, attendingAt: null },
  });
  if (res.count === 1) {
    await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
  }
}
