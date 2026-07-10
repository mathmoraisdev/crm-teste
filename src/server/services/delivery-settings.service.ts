import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";

/** Horário por dia da semana (0=domingo..6=sábado). Cada dia = lista de janelas HH:MM. */
export type DeliveryHours = Record<string, { open: string; close: string }[]>;

export interface DeliverySettingsDTO {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  payOnlineEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  minOrderCents: number;
  defaultPrepMinutes: number;
  hours: DeliveryHours | null;
  /** Ordem manual dos tópicos do cardápio (nomes de menuCategory). Vazio = alfabético. */
  categoryOrder: string[];
}

const DEFAULTS: DeliverySettingsDTO = {
  deliveryEnabled: true,
  pickupEnabled: true,
  payOnlineEnabled: true,
  payOnDeliveryEnabled: true,
  minOrderCents: 0,
  defaultPrepMinutes: 30,
  hours: null,
  categoryOrder: [],
};

/** Lê um array de strings de um campo JSON solto (defensivo: null/valor torto → []). */
function toStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function toDTO(row: {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  payOnlineEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  minOrderCents: number;
  defaultPrepMinutes: number;
  hoursJson: Prisma.JsonValue | null;
  categoryOrderJson: Prisma.JsonValue | null;
}): DeliverySettingsDTO {
  return {
    deliveryEnabled: row.deliveryEnabled,
    pickupEnabled: row.pickupEnabled,
    payOnlineEnabled: row.payOnlineEnabled,
    payOnDeliveryEnabled: row.payOnDeliveryEnabled,
    minOrderCents: row.minOrderCents,
    defaultPrepMinutes: row.defaultPrepMinutes,
    hours: (row.hoursJson as DeliveryHours | null) ?? null,
    categoryOrder: toStringArray(row.categoryOrderJson),
  };
}

/** Lê as configurações de delivery da conta; devolve os defaults quando ainda não configurada. */
export async function getDeliverySettings(accountId: string): Promise<DeliverySettingsDTO> {
  const row = await prisma.deliverySettings.findUnique({ where: { accountId } });
  return row ? toDTO(row) : { ...DEFAULTS };
}

export type DeliverySettingsPatch = Partial<
  Omit<DeliverySettingsDTO, "hours" | "categoryOrder"> & {
    hours?: DeliveryHours | null;
    categoryOrder?: string[];
  }
>;

/** Upsert das configurações de delivery. Clampa inteiros negativos. */
export async function updateDeliverySettings(
  accountId: string,
  patch: DeliverySettingsPatch,
): Promise<DeliverySettingsDTO> {
  const data = {
    ...(patch.deliveryEnabled !== undefined ? { deliveryEnabled: patch.deliveryEnabled } : {}),
    ...(patch.pickupEnabled !== undefined ? { pickupEnabled: patch.pickupEnabled } : {}),
    ...(patch.payOnlineEnabled !== undefined ? { payOnlineEnabled: patch.payOnlineEnabled } : {}),
    ...(patch.payOnDeliveryEnabled !== undefined
      ? { payOnDeliveryEnabled: patch.payOnDeliveryEnabled }
      : {}),
    ...(patch.minOrderCents !== undefined
      ? { minOrderCents: Math.max(0, Math.floor(patch.minOrderCents)) }
      : {}),
    ...(patch.defaultPrepMinutes !== undefined
      ? { defaultPrepMinutes: Math.max(0, Math.floor(patch.defaultPrepMinutes)) }
      : {}),
    ...(patch.hours !== undefined
      ? { hoursJson: patch.hours === null ? Prisma.JsonNull : (patch.hours as Prisma.InputJsonValue) }
      : {}),
    ...(patch.categoryOrder !== undefined
      ? { categoryOrderJson: patch.categoryOrder as unknown as Prisma.InputJsonValue }
      : {}),
  };
  const row = await prisma.deliverySettings.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
  return toDTO(row);
}
