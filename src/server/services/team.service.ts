import { prisma } from "@/server/db/client";
import { hashPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/email";
import { PLAN_LIMITS } from "@/lib/plans";
import type { AccountRole } from "@prisma/client";

export interface CreateOperatorInput {
  name: string;
  email: string;
  password: string;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
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
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  return members;
}

/** Remove um operador — valida que ele pertence a este dono antes de apagar. */
export async function removeOperator(adminUserId: string, operatorId: string): Promise<void> {
  const op = await prisma.user.findFirst({
    where: { id: operatorId, ownerId: adminUserId },
    select: { id: true },
  });
  if (!op) throw new Error("Operador não encontrado nesta conta.");
  await prisma.user.delete({ where: { id: operatorId } });
}
