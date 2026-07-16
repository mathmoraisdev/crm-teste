import { prisma } from "@/server/db/client";

export interface DeliveryZoneDTO {
  id: string;
  name: string;
  feeCents: number;
  minOrderCents: number | null;
  active: boolean;
}

function toDTO(z: {
  id: string;
  name: string;
  feeCents: number;
  minOrderCents: number | null;
  active: boolean;
}): DeliveryZoneDTO {
  return { id: z.id, name: z.name, feeCents: z.feeCents, minOrderCents: z.minOrderCents, active: z.active };
}

/** Lista as zonas ativas da conta (público). `includeInactive` para o painel do lojista. */
export async function listZones(
  accountId: string,
  opts?: { includeInactive?: boolean },
): Promise<DeliveryZoneDTO[]> {
  const rows = await prisma.deliveryZone.findMany({
    where: { accountId, ...(opts?.includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
  });
  return rows.map(toDTO);
}

export interface CreateZoneInput {
  name: string;
  feeCents: number;
  minOrderCents?: number | null;
}

export async function createZone(accountId: string, data: CreateZoneInput): Promise<DeliveryZoneDTO> {
  const name = data.name.trim();
  if (!name) throw new Error("Informe o nome do bairro/zona.");
  const z = await prisma.deliveryZone.create({
    data: {
      accountId,
      name,
      feeCents: Math.max(0, Math.floor(data.feeCents)),
      minOrderCents: data.minOrderCents ?? null,
    },
  });
  return toDTO(z);
}

export type ZonePatch = Partial<{
  name: string;
  feeCents: number;
  minOrderCents: number | null;
  active: boolean;
}>;

export async function updateZone(
  accountId: string,
  id: string,
  patch: ZonePatch,
): Promise<DeliveryZoneDTO> {
  const owned = await prisma.deliveryZone.findFirst({ where: { id, accountId } });
  if (!owned) throw new Error("Zona não encontrada.");
  const z = await prisma.deliveryZone.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.feeCents !== undefined ? { feeCents: Math.max(0, Math.floor(patch.feeCents)) } : {}),
      ...(patch.minOrderCents !== undefined ? { minOrderCents: patch.minOrderCents } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
  });
  return toDTO(z);
}

export async function deleteZone(accountId: string, id: string): Promise<void> {
  const owned = await prisma.deliveryZone.findFirst({ where: { id, accountId } });
  if (!owned) throw new Error("Zona não encontrada.");
  await prisma.deliveryZone.delete({ where: { id } });
}

/** Resolve a taxa de uma zona (tenant-safe). Zona inativa ou de outra conta → erro. */
export async function resolveZoneFee(
  accountId: string,
  zoneId: string,
): Promise<{ zoneId: string; feeCents: number; minOrderCents: number | null }> {
  const z = await prisma.deliveryZone.findFirst({ where: { id: zoneId, accountId, active: true } });
  if (!z) throw new Error("Zona de entrega inválida.");
  return { zoneId: z.id, feeCents: z.feeCents, minOrderCents: z.minOrderCents };
}
