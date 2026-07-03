import { prisma } from "@/server/db/client";
import { BRAND_STOPS, DEFAULT_PALETTE, type BrandPalette } from "@/lib/theme/palette";
import type { AccountBranding } from "@prisma/client";

export const DEFAULT_APP_NAME = "Disparador.ai";

export interface ResolvedBranding {
  palette: BrandPalette;
  appName: string;
  logoUrl: string | null;
  presetId: string | null; // p/ pré-selecionar o preset atual na UI
}

/** Valida que um JSON tem as 11 paradas com formato "R G B"; senão null. */
function asValidPalette(raw: unknown): BrandPalette | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as BrandPalette;
  for (const s of BRAND_STOPS) {
    const v = obj[`${s}`];
    if (typeof v !== "string" || v.split(" ").map(Number).filter((n) => n >= 0 && n <= 255).length !== 3) {
      return null;
    }
    out[`${s}`] = v;
  }
  return out;
}

/** Resolve a linha (ou null) num branding SEMPRE completo, com defaults seguros. */
export function resolveBranding(row: AccountBranding | null): ResolvedBranding {
  return {
    palette: asValidPalette(row?.brandScale) ?? DEFAULT_PALETTE,
    appName: row?.appName?.trim() || DEFAULT_APP_NAME,
    logoUrl: row?.logoUrl ?? null,
    presetId: row?.presetId ?? null,
  };
}

/** Lê o branding do dono da conta e resolve (com fallback). Barato: 1 query. */
export async function getBranding(tenantUserId: string): Promise<ResolvedBranding> {
  const row = await prisma.accountBranding.findUnique({ where: { accountId: tenantUserId } });
  return resolveBranding(row);
}
