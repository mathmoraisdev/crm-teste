import { prisma } from "@/server/db/client";
import { hashPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/email";
import { PLAN_LIMITS } from "@/lib/plans";
import type { AccountRole, LeadsScope } from "@prisma/client";

/** Limitações configuráveis de um operador. Default = acesso total (igual hoje). */
export interface OperatorPermsInput {
  canCampaigns?: boolean;
  canSettings?: boolean;
  leadsScope?: LeadsScope;
}

export interface CreateOperatorInput extends OperatorPermsInput {
  name: string;
  email: string;
  password: string;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  canCampaigns: boolean;
  canSettings: boolean;
  leadsScope: LeadsScope;
  createdAt: Date;
}

/**
 * Provisiona um operador na conta do dono (`adminUserId`). Regras:
 * - Só o DONO (ADMIN, sem ownerId) pode criar — operador chamando é rejeitado.
 * - Exige plano definido no dono (null → entitlements não aplicados, mas sem
 *   plano não há teto de seats conhecido → bloqueia para forçar a escolha).
 * - Respeita `PLAN_LIMITS[plan].maxSeats` (conta o dono + operadores).
 * - E-mail único global (igual ao cadastro).
 * O operador nasce com `ownerId = dono`, `role = OPERADOR`, sem billing/plano.
 */
export async function createOperator(
  adminUserId: string,
  input: CreateOperatorInput,
): Promise<{ id: string }> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { id: true, ownerId: true, role: true, plan: true },
  });
  if (!admin || admin.ownerId !== null || admin.role !== "ADMIN") {
    throw new Error("Apenas o administrador da conta pode adicionar usuários.");
  }
  if (!admin.plan) {
    throw new Error("Defina um plano para a conta antes de adicionar usuários.");
  }

  const email = normalizeEmail(input.email);
  if (!email) throw new Error("E-mail inválido.");
  if (input.password.length < 8) {
    throw new Error("A senha precisa ter ao menos 8 caracteres.");
  }

  const maxSeats = PLAN_LIMITS[admin.plan].maxSeats;
  const used = await prisma.user.count({
    where: { OR: [{ id: adminUserId }, { ownerId: adminUserId }] },
  });
  if (used >= maxSeats) {
    throw new Error(`Seu plano permite ${maxSeats} usuários (limite atingido).`);
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error("Já existe uma conta com este e-mail.");

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash: hashPassword(input.password),
      role: "OPERADOR",
      ownerId: adminUserId,
      canCampaigns: input.canCampaigns ?? true,
      canSettings: input.canSettings ?? true,
      leadsScope: input.leadsScope ?? "ALL",
    },
    select: { id: true },
  });
  return { id: user.id };
}

/** Lista os operadores da conta do dono (não inclui o próprio dono). */
export async function listMembers(adminUserId: string): Promise<MemberRow[]> {
  const members = await prisma.user.findMany({
    where: { ownerId: adminUserId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      canCampaigns: true,
      canSettings: true,
      leadsScope: true,
      createdAt: true,
    },
  });
  return members;
}

/**
 * Atualiza as limitações de um operador. Valida que ele pertence a este dono.
 * Só altera os campos informados (merge) — não mexe em nome/e-mail/senha.
 */
export async function updateOperatorPerms(
  adminUserId: string,
  operatorId: string,
  perms: OperatorPermsInput,
): Promise<void> {
  const op = await prisma.user.findFirst({
    where: { id: operatorId, ownerId: adminUserId },
    select: { id: true },
  });
  if (!op) throw new Error("Operador não encontrado nesta conta.");
  await prisma.user.update({
    where: { id: op.id },
    data: {
      ...(perms.canCampaigns !== undefined ? { canCampaigns: perms.canCampaigns } : {}),
      ...(perms.canSettings !== undefined ? { canSettings: perms.canSettings } : {}),
      ...(perms.leadsScope !== undefined ? { leadsScope: perms.leadsScope } : {}),
    },
  });
}

/** Remove um operador — valida que ele pertence a este dono antes de apagar. */
export async function removeOperator(adminUserId: string, operatorId: string): Promise<void> {
  const op = await prisma.user.findFirst({
    where: { id: operatorId, ownerId: adminUserId },
    select: { id: true },
  });
  if (!op) throw new Error("Operador não encontrado nesta conta.");
  // Ponteiros de auditoria para o operador são FKs RESTRICT (comandas que ele abriu,
  // despesas/despesas-fixas que ele lançou, movimentos de estoque que ele gerou — a
  // baixa ao fechar comanda grava createdById = operador). Sem reatribuir ao dono, o
  // delete falha com P2003 e a vaga fica presa. Reatribui ao dono (registro preservado).
  await prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { openedById: operatorId }, data: { openedById: adminUserId } });
    await tx.expense.updateMany({ where: { createdById: operatorId }, data: { createdById: adminUserId } });
    await tx.recurringExpense.updateMany({ where: { createdById: operatorId }, data: { createdById: adminUserId } });
    await tx.stockMovement.updateMany({ where: { createdById: operatorId }, data: { createdById: adminUserId } });
    await tx.user.delete({ where: { id: operatorId } });
  });
}
