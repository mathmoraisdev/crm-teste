import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import {
  getFiscalCredentialStatus,
  saveFiscalCredential,
  setFiscalProfile,
  removeFiscalCredential,
} from "@/server/services/fiscal-credential.service";

export const dynamic = "force-dynamic";

const NO_SETTINGS_PERM =
  "Seu usuário não tem permissão para alterar as configurações da conta.";

const saveSchema = z.object({
  provider: z.enum(["FOCUS_NFE", "PLUGNOTAS", "TECNOSPEED"]),
  apiKey: z.string().min(12),
  env: z.enum(["HOMOLOGACAO", "PRODUCAO"]),
});

const profileSchema = z.object({
  fiscalEnabled: z.boolean().optional(),
  fiscalSerie: z.number().int().min(1).optional(),
  fiscalCnpj: z.string().nullish(),
  fiscalDefaultNcm: z.string().nullish(),
  fiscalDefaultCfop: z.string().nullish(),
});

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  // Credencial/perfil fiscal são do DONO (tenant).
  return NextResponse.json(await getFiscalCredentialStatus(ctx.tenantUserId));
}

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!ctx.perms.canFinance) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    const status = await saveFiscalCredential(
      ctx.tenantUserId,
      parsed.data.provider,
      parsed.data.apiKey,
      parsed.data.env,
    );
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar." },
      { status: 400 },
    );
  }
}

export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!ctx.perms.canFinance) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  const parsed = profileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    const status = await setFiscalProfile(ctx.tenantUserId, parsed.data);
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar." },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!ctx.perms.canFinance) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  await removeFiscalCredential(ctx.tenantUserId);
  return NextResponse.json({ ok: true });
}
