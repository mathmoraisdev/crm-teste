import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";
import type { DayWindow } from "@/lib/agenda/availability";

/**
 * Profissionais (equipe que atende): cada Appointment pode ser atribuído a um.
 * Scoping SEMPRE por `accountId` (User.id do dono). O vínculo opcional a um
 * membro (userId) só é aceito se o User for da conta — o próprio dono ou alguém
 * cujo ownerId aponta para a conta. Desativação é SOFT (active=false) para nunca
 * perder o histórico de agendamentos.
 */

export interface ProfessionalDTO {
  id: string;
  name: string;
  active: boolean;
  color: string;
  userId: string | null;
  memberName: string | null;
}

function toDTO(o: {
  id: string; name: string; active: boolean; color: string; userId: string | null;
  member?: { name: string | null } | null;
}): ProfessionalDTO {
  return {
    id: o.id, name: o.name, active: o.active, color: o.color, userId: o.userId,
    memberName: o.member?.name ?? null,
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  color: z.string().trim().min(1).optional(),
  userId: z.string().nullish(),
});

/** Confere que o User é membro desta conta (o próprio dono ou alguém sob ownerId). */
async function assertMemberOfAccount(accountId: string, userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, OR: [{ id: accountId }, { ownerId: accountId }] },
    select: { id: true },
  });
  if (!user) throw new Error("Usuário não pertence a esta conta.");
}

export async function listProfessionals(
  accountId: string,
  opts?: { activeOnly?: boolean },
): Promise<ProfessionalDTO[]> {
  const rows = await prisma.professional.findMany({
    where: { accountId, ...(opts?.activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { member: { select: { name: true } } },
  });
  return rows.map(toDTO);
}

export async function createProfessional(
  accountId: string,
  data: { name: string; color?: string; userId?: string | null },
): Promise<ProfessionalDTO> {
  const parsed = createSchema.parse(data);
  const userId = parsed.userId ?? null;
  if (userId) await assertMemberOfAccount(accountId, userId);
  const row = await prisma.professional.create({
    data: {
      accountId,
      name: parsed.name,
      ...(parsed.color ? { color: parsed.color } : {}),
      userId,
    },
    include: { member: { select: { name: true } } },
  });
  return toDTO(row);
}

export async function updateProfessional(
  accountId: string,
  id: string,
  data: { name?: string; color?: string; active?: boolean; userId?: string | null },
): Promise<ProfessionalDTO> {
  const owned = await prisma.professional.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Profissional não encontrado.");
  const patch: Prisma.ProfessionalUpdateInput = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Nome obrigatório.");
    patch.name = name;
  }
  if (data.color !== undefined) {
    const color = data.color.trim();
    if (!color) throw new Error("Cor obrigatória.");
    patch.color = color;
  }
  if (data.active !== undefined) patch.active = data.active;
  if (data.userId !== undefined) {
    if (data.userId) {
      await assertMemberOfAccount(accountId, data.userId);
      patch.member = { connect: { id: data.userId } };
    } else {
      patch.member = { disconnect: true };
    }
  }
  const row = await prisma.professional.update({
    where: { id },
    data: patch,
    include: { member: { select: { name: true } } },
  });
  return toDTO(row);
}

/** Desativa (SOFT): mantém o registro para preservar o histórico de agendamentos. */
export async function deactivateProfessional(accountId: string, id: string): Promise<ProfessionalDTO> {
  const owned = await prisma.professional.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Profissional não encontrado.");
  const row = await prisma.professional.update({
    where: { id },
    data: { active: false },
    include: { member: { select: { name: true } } },
  });
  return toDTO(row);
}

// ── Horário de funcionamento (grade de expediente) ───────────────────────────

export interface WorkingHoursDTO {
  id: string;
  professionalId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  breakStart: number | null;
  breakEnd: number | null;
}

function toHoursDTO(o: {
  id: string; professionalId: string | null; weekday: number; startMinute: number;
  endMinute: number; breakStart: number | null; breakEnd: number | null;
}): WorkingHoursDTO {
  return {
    id: o.id, professionalId: o.professionalId, weekday: o.weekday,
    startMinute: o.startMinute, endMinute: o.endMinute,
    breakStart: o.breakStart, breakEnd: o.breakEnd,
  };
}

const hoursRowSchema = z.object({
  weekday: z.number().int().min(0, "Dia da semana inválido.").max(6, "Dia da semana inválido."),
  startMinute: z.number().int().min(0, "Horário inválido.").max(1440, "Horário inválido."),
  endMinute: z.number().int().min(0, "Horário inválido.").max(1440, "Horário inválido."),
  breakStart: z.number().int().min(0).max(1440).nullish(),
  breakEnd: z.number().int().min(0).max(1440).nullish(),
}).refine((r) => r.startMinute < r.endMinute, {
  message: "Início do expediente deve ser antes do fim.",
});

/** Confere que o profissional é da conta antes de gravar a grade dele. */
async function assertProfessionalOwned(accountId: string, professionalId: string): Promise<void> {
  const p = await prisma.professional.findFirst({ where: { id: professionalId, accountId }, select: { id: true } });
  if (!p) throw new Error("Profissional não encontrado.");
}

export async function listWorkingHours(
  accountId: string,
  professionalId: string | null,
): Promise<WorkingHoursDTO[]> {
  const rows = await prisma.workingHours.findMany({
    where: { accountId, professionalId },
    orderBy: { weekday: "asc" },
  });
  return rows.map(toHoursDTO);
}

/**
 * Janelas de expediente aplicáveis a um profissional num `weekday` (0=Dom..6=Sáb).
 * Prioriza a grade PRÓPRIA do profissional; se ele não tem linha nesse dia, cai no
 * expediente PADRÃO da conta (professionalId null); vazio = sem expediente no dia.
 * Mesma regra que o `loadWorkingWindows` (privado) do appointment.service, mas
 * exportada e recebendo o `weekday` pronto — dono único que a borda pública reusa.
 */
export async function resolveWorkingWindows(
  accountId: string,
  professionalId: string,
  weekday: number,
): Promise<DayWindow[]> {
  const own = await prisma.workingHours.findMany({
    where: { accountId, professionalId, weekday },
    select: { startMinute: true, endMinute: true, breakStart: true, breakEnd: true },
  });
  const rows =
    own.length > 0
      ? own
      : await prisma.workingHours.findMany({
          where: { accountId, professionalId: null, weekday },
          select: { startMinute: true, endMinute: true, breakStart: true, breakEnd: true },
        });
  return rows.map((r) => ({
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    breakStart: r.breakStart,
    breakEnd: r.breakEnd,
  }));
}

/**
 * REPLACE-ALL da grade de um escopo (accountId + professionalId): apaga as linhas
 * anteriores e recria as novas numa transação. professionalId null = expediente
 * padrão da conta. Se veio professionalId, valida que é da conta antes.
 */
export async function setWorkingHours(
  accountId: string,
  professionalId: string | null,
  rows: Array<{ weekday: number; startMinute: number; endMinute: number; breakStart?: number | null; breakEnd?: number | null }>,
): Promise<WorkingHoursDTO[]> {
  if (professionalId !== null) await assertProfessionalOwned(accountId, professionalId);
  const parsed = rows.map((r) => hoursRowSchema.parse(r));
  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { accountId, professionalId } }),
    prisma.workingHours.createMany({
      data: parsed.map((r) => ({
        accountId,
        professionalId,
        weekday: r.weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        breakStart: r.breakStart ?? null,
        breakEnd: r.breakEnd ?? null,
      })),
    }),
  ]);
  return listWorkingHours(accountId, professionalId);
}
