import { prisma } from "@/server/db/client";

/**
 * Configurações globais do app (tabela AppSetting, key/value). São de SISTEMA
 * — valem para a instância toda, não por conta. Lidas em rotas públicas (raiz)
 * e escritas pelo admin (Financeiro).
 */

const LANDING_KEY = "landing.enabled";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * A raiz "/" deve mostrar a landing de marketing?
 * Padrão (sem registro) = false → raiz redireciona direto para o login. A landing
 * continua acessível em /landing (preview) e religa por aqui pelo admin.
 */
export async function isLandingEnabled(): Promise<boolean> {
  return (await getSetting(LANDING_KEY)) === "1";
}

export async function setLandingEnabled(enabled: boolean): Promise<void> {
  await setSetting(LANDING_KEY, enabled ? "1" : "0");
}
