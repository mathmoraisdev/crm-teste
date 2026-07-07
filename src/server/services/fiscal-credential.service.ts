import { prisma } from "@/server/db/client";
import { isEncryptionConfigured } from "@/lib/env";
import { encryptSecret } from "@/server/crypto";
import { fiscalEmitterFor } from "@/server/fiscal/emitter";
import type { FiscalProvider, FiscalEnv } from "@prisma/client";

export interface FiscalCredentialStatus {
  configured: boolean;
  provider: FiscalProvider | null;
  last4: string | null;
  verifiedAt: string | null;
  enabled: boolean;
  env: FiscalEnv;
  serie: number;
  cnpj: string | null;
  defaultNcm: string | null;
  defaultCfop: string | null;
}

export async function getFiscalCredentialStatus(
  userId: string,
): Promise<FiscalCredentialStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      fiscalProvider: true,
      fiscalKeyLast4: true,
      fiscalKeyVerifiedAt: true,
      fiscalEnabled: true,
      fiscalEnv: true,
      fiscalSerie: true,
      fiscalCnpj: true,
      fiscalDefaultNcm: true,
      fiscalDefaultCfop: true,
    },
  });
  return {
    configured: !!u?.fiscalProvider,
    provider: u?.fiscalProvider ?? null,
    last4: u?.fiscalKeyLast4 ?? null,
    verifiedAt: u?.fiscalKeyVerifiedAt ? u.fiscalKeyVerifiedAt.toISOString() : null,
    enabled: !!u?.fiscalEnabled,
    env: u?.fiscalEnv ?? "HOMOLOGACAO",
    serie: u?.fiscalSerie ?? 1,
    cnpj: u?.fiscalCnpj ?? null,
    defaultNcm: u?.fiscalDefaultNcm ?? null,
    defaultCfop: u?.fiscalDefaultCfop ?? null,
  };
}

/** Valida o token contra o emissor e persiste cifrado. NÃO liga a emissão (opt-in é à parte). */
export async function saveFiscalCredential(
  userId: string,
  provider: FiscalProvider,
  apiKey: string,
  fiscalEnv: FiscalEnv,
): Promise<FiscalCredentialStatus> {
  const key = apiKey.trim();
  if (key.length < 12) throw new Error("Token do emissor fiscal inválido.");
  if (!isEncryptionConfigured) {
    throw new Error("Recurso indisponível no momento. Tente novamente mais tarde.");
  }
  let ok = false;
  try {
    ok = await fiscalEmitterFor(provider).verifyCredential(key, fiscalEnv);
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error("Não consegui validar o token no emissor. Confira o provedor e a chave.");
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      fiscalProvider: provider,
      fiscalKeyEnc: encryptSecret(key),
      fiscalKeyLast4: key.slice(-4),
      fiscalKeyVerifiedAt: new Date(),
      fiscalEnv,
    },
  });
  return getFiscalCredentialStatus(userId);
}

/** Perfil fiscal (série, CNPJ, NCM/CFOP padrão) + liga/desliga o opt-in. */
export async function setFiscalProfile(
  userId: string,
  patch: {
    fiscalEnabled?: boolean;
    fiscalSerie?: number;
    fiscalCnpj?: string | null;
    fiscalDefaultNcm?: string | null;
    fiscalDefaultCfop?: string | null;
  },
): Promise<FiscalCredentialStatus> {
  // Ligar exige credencial já configurada (senão o worker não teria com o que emitir).
  if (patch.fiscalEnabled) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { fiscalProvider: true },
    });
    if (!u?.fiscalProvider) {
      throw new Error("Configure o emissor fiscal antes de ligar a emissão.");
    }
  }
  await prisma.user.update({ where: { id: userId }, data: { ...patch } });
  return getFiscalCredentialStatus(userId);
}

export async function removeFiscalCredential(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      fiscalProvider: null,
      fiscalKeyEnc: null,
      fiscalKeyLast4: null,
      fiscalKeyVerifiedAt: null,
      fiscalEnabled: false,
    },
  });
}
