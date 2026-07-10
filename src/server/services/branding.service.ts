import { prisma } from "@/server/db/client";
import { BRAND_STOPS, DEFAULT_PALETTE, type BrandPalette } from "@/lib/theme/palette";
import { presetById } from "@/lib/theme/presets";
import type { AccountBranding } from "@prisma/client";

export const DEFAULT_APP_NAME = "Disparador.ai";

export type PublicTheme = "light" | "dark";

export interface ResolvedBranding {
  palette: BrandPalette;
  appName: string;
  logoUrl: string | null;
  presetId: string | null; // p/ pré-selecionar o preset atual na UI
  publicTheme: PublicTheme; // tema das páginas públicas (cardápio/agendamento); default claro
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
    // Qualquer valor que não seja exatamente "dark" cai em claro (default seguro).
    publicTheme: row?.publicTheme === "dark" ? "dark" : "light",
  };
}

/** Lê o branding do dono da conta e resolve (com fallback). Barato: 1 query. */
export async function getBranding(tenantUserId: string): Promise<ResolvedBranding> {
  try {
    const row = await prisma.accountBranding.findUnique({ where: { accountId: tenantUserId } });
    return resolveBranding(row);
  } catch (e) {
    // Branding é cosmético e vive no layout RAIZ do app — uma falha de leitura
    // (tabela ainda não migrada em prod, hiccup de conexão, etc.) NUNCA deve
    // derrubar todas as telas. Degrada para o tema default.
    console.warn(
      `[branding] getBranding falhou, usando tema default: ${e instanceof Error ? e.message : String(e)}`,
    );
    return resolveBranding(null);
  }
}

/**
 * Aplica um preset de tema ao branding da conta (upsert idempotente).
 * Retorna false se o preset não existir; true se aplicado.
 */
export async function setBrandingPreset(accountId: string, presetId: string): Promise<boolean> {
  const preset = presetById(presetId);
  if (!preset) return false;
  await prisma.accountBranding.upsert({
    where: { accountId },
    create: { accountId, presetId: preset.id, brandScale: preset.palette },
    update: { presetId: preset.id, brandScale: preset.palette },
  });
  return true;
}
