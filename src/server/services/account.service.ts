import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";

/**
 * True se a conta dona do lead está ativa (pagamento em dia). Fail-safe: se o
 * lead/conta não for encontrado, devolve `false` — preferimos silenciar a IA a
 * responder em nome de uma conta indefinida.
 */
export async function isAccountActiveByLead(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { user: { select: { billingActive: true } } },
  });
  return lead?.user?.billingActive === true;
}

/**
 * True se a conta (por id do usuário logado) está habilitada no painel
 * Financeiro. Gate das ações de campanha (criar/disparar): conta suspensa só
 * vira ativa pela liberação do admin. Fail-safe: usuário inexistente → false.
 */
export async function isAccountActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billingActive: true },
  });
  return user?.billingActive === true;
}

/** Linha de conta para o painel admin (Financeiro). */
export interface AdminAccountRow {
  id: string;
  name: string;
  email: string;
  billingActive: boolean;
  isAdmin: boolean;
  numbers: number;
  leads: number;
  createdAt: Date;
}

/** Lista todas as contas com contadores, para o painel Financeiro. */
export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      billingActive: true,
      createdAt: true,
      _count: { select: { whatsAppNumbers: true, leads: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    billingActive: u.billingActive,
    isAdmin: isAdminEmail(u.email),
    numbers: u._count.whatsAppNumbers,
    leads: u._count.leads,
    createdAt: u.createdAt,
  }));
}

/**
 * Ativa/suspende uma conta. Trava de segurança: NUNCA suspende uma conta admin
 * (evita o operador se cortar por engano). Devolve o novo estado.
 */
export async function setAccountBilling(
  userId: string,
  active: boolean,
): Promise<{ id: string; billingActive: boolean }> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) throw new Error("Conta não encontrada.");
  if (!active && isAdminEmail(target.email)) {
    throw new Error("Não é possível suspender uma conta admin.");
  }
  return prisma.user.update({
    where: { id: userId },
    data: { billingActive: active },
    select: { id: true, billingActive: true },
  });
}
