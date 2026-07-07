import { prisma } from "@/server/db/client";
import { getCurrentUserId } from "@/lib/session";
import type { AccountRole, LeadsScope } from "@prisma/client";

/** Permissões efetivas do usuário logado (no dono/ADMIN, sempre acesso total). */
export interface OperatorPerms {
  canCampaigns: boolean;
  canSettings: boolean;
  canFinance: boolean;
  leadsScope: LeadsScope;
}

export interface TenantContext {
  sessionUserId: string; // quem está logado (operador ou dono) — auditoria/permissão
  tenantUserId: string;  // dono que escopa os DADOS (ownerId ?? id)
  role: AccountRole;
  perms: OperatorPerms;
}

/** Resolve o contexto de tenant a partir de um userId de sessão. */
export async function resolveTenant(sessionUserId: string): Promise<TenantContext | null> {
  const u = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      ownerId: true,
      role: true,
      canCampaigns: true,
      canSettings: true,
      canFinance: true,
      leadsScope: true,
    },
  });
  if (!u) return null;
  // O dono/ADMIN ignora as flags e tem acesso total; só o OPERADOR é limitado.
  const perms: OperatorPerms =
    u.role === "ADMIN"
      ? { canCampaigns: true, canSettings: true, canFinance: true, leadsScope: "ALL" }
      : { canCampaigns: u.canCampaigns, canSettings: u.canSettings, canFinance: u.canFinance, leadsScope: u.leadsScope };
  return { sessionUserId: u.id, tenantUserId: u.ownerId ?? u.id, role: u.role, perms };
}

/** Atalho p/ rotas: lê o cookie de sessão e resolve o contexto (ou null). */
export async function getTenantContext(): Promise<TenantContext | null> {
  const sid = await getCurrentUserId();
  return sid ? resolveTenant(sid) : null;
}

/** Só o id que escopa os dados (ou null se não logado). */
export async function getTenantUserId(): Promise<string | null> {
  const ctx = await getTenantContext();
  return ctx?.tenantUserId ?? null;
}
