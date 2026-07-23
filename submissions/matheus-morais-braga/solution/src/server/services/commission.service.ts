import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";

/**
 * Regras de comissão por profissional. Scoping SEMPRE por `accountId` (User.id do
 * dono). percentBps (pontos-base, 4000 = 40,00%) OU fixedCents (por unidade) —
 * exatamente um. A específica do serviço (catalogItemId setado) vence a padrão do
 * profissional (catalogItemId null). Desativação é SOFT (active=false), coerente
 * com Professional — snapshots antigos de comanda ficam intactos.
 */

export interface CommissionRuleDTO {
  id: string;
  professionalId: string;
  professionalName: string;
  catalogItemId: string | null;
  serviceName: string | null;
  percentBps: number | null;
  fixedCents: number | null;
  active: boolean;
}

function toDTO(o: {
  id: string; professionalId: string; catalogItemId: string | null;
  percentBps: number | null; fixedCents: number | null; active: boolean;
  professional: { name: string }; catalogItem: { name: string } | null;
}): CommissionRuleDTO {
  return {
    id: o.id,
    professionalId: o.professionalId,
    professionalName: o.professional.name,
    catalogItemId: o.catalogItemId,
    serviceName: o.catalogItem?.name ?? null,
    percentBps: o.percentBps,
    fixedCents: o.fixedCents,
    active: o.active,
  };
}

const include = {
  professional: { select: { name: true } },
  catalogItem: { select: { name: true } },
} satisfies Prisma.CommissionRuleInclude;

// "Exatamente um" de percentBps/fixedCents, com faixas. Usado no create e no update
// (que reconstrói o par final antes de validar). null explícito zera o outro lado.
const valueSchema = z
  .object({
    percentBps: z.number().int().min(1, "Percentual entre 1 e 100%.").max(10000, "Percentual entre 1 e 100%.").nullable(),
    fixedCents: z.number().int().positive("Valor fixo deve ser maior que zero.").nullable(),
  })
  .refine((v) => (v.percentBps != null) !== (v.fixedCents != null), {
    message: "Informe exatamente um: percentual OU valor fixo.",
  });

async function assertProfessionalOwned(accountId: string, professionalId: string): Promise<void> {
  const p = await prisma.professional.findFirst({ where: { id: professionalId, accountId }, select: { id: true } });
  if (!p) throw new Error("Profissional não encontrado.");
}

async function assertCatalogItemOwned(accountId: string, catalogItemId: string): Promise<void> {
  const c = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, accountId }, select: { id: true } });
  if (!c) throw new Error("Serviço não encontrado.");
}

export async function listCommissionRules(accountId: string): Promise<CommissionRuleDTO[]> {
  const rows = await prisma.commissionRule.findMany({
    where: { accountId },
    orderBy: [{ professional: { name: "asc" } }, { catalogItemId: "asc" }],
    include,
  });
  return rows.map(toDTO);
}

export async function createCommissionRule(
  accountId: string,
  data: { professionalId: string; catalogItemId?: string | null; percentBps?: number | null; fixedCents?: number | null },
): Promise<CommissionRuleDTO> {
  const { percentBps, fixedCents } = valueSchema.parse({
    percentBps: data.percentBps ?? null,
    fixedCents: data.fixedCents ?? null,
  });
  const catalogItemId = data.catalogItemId ?? null;
  await assertProfessionalOwned(accountId, data.professionalId);
  if (catalogItemId) await assertCatalogItemOwned(accountId, catalogItemId);

  // Unicidade por (professionalId, catalogItemId|null): o @@unique do Prisma não
  // cobre a regra-padrão porque nulos são distintos no Postgres — findFirst antes.
  const dup = await prisma.commissionRule.findFirst({
    where: { professionalId: data.professionalId, catalogItemId },
    select: { id: true },
  });
  if (dup) throw new Error("Já existe regra para este profissional/serviço.");

  const row = await prisma.commissionRule.create({
    data: { accountId, professionalId: data.professionalId, catalogItemId, percentBps, fixedCents },
    include,
  });
  return toDTO(row);
}

export async function updateCommissionRule(
  accountId: string,
  id: string,
  patch: { percentBps?: number | null; fixedCents?: number | null; active?: boolean },
): Promise<CommissionRuleDTO> {
  const owned = await prisma.commissionRule.findFirst({
    where: { id, accountId },
    select: { percentBps: true, fixedCents: true },
  });
  if (!owned) throw new Error("Regra de comissão não encontrada.");

  const data: Prisma.CommissionRuleUpdateInput = {};
  if (patch.percentBps !== undefined || patch.fixedCents !== undefined) {
    // Reconstrói o par final: um lado setado no patch zera o outro (troca percent↔fixo).
    const next =
      patch.percentBps != null
        ? { percentBps: patch.percentBps, fixedCents: null }
        : patch.fixedCents != null
          ? { percentBps: null, fixedCents: patch.fixedCents }
          : { percentBps: patch.percentBps ?? owned.percentBps, fixedCents: patch.fixedCents ?? owned.fixedCents };
    const parsed = valueSchema.parse(next);
    data.percentBps = parsed.percentBps;
    data.fixedCents = parsed.fixedCents;
  }
  if (patch.active !== undefined) data.active = patch.active;

  const row = await prisma.commissionRule.update({ where: { id }, data, include });
  return toDTO(row);
}

/** Desativa (SOFT): some do cálculo do próximo fechamento; snapshots antigos ficam. */
export async function deactivateCommissionRule(accountId: string, id: string): Promise<CommissionRuleDTO> {
  const owned = await prisma.commissionRule.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Regra de comissão não encontrada.");
  const row = await prisma.commissionRule.update({ where: { id }, data: { active: false }, include });
  return toDTO(row);
}
