import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import {
  getPaymentCredentialStatus,
  savePaymentCredential,
  removePaymentCredential,
} from "@/server/services/payment-credential.service";

export const dynamic = "force-dynamic";

const NO_SETTINGS_PERM =
  "Seu usuário não tem permissão para alterar as configurações da conta.";

const bodySchema = z.object({
  provider: z.enum(["MERCADO_PAGO", "ASAAS"]),
  apiKey: z.string().min(12),
});

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  // Credencial de pagamento é do DONO (tenant) — billing/cobrança vivem no dono.
  return NextResponse.json(await getPaymentCredentialStatus(ctx.tenantUserId));
}

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    // Grava no DONO (tenantUserId): o gate de plano e a resolução do token no
    // runtime usam o dono da conta.
    const status = await savePaymentCredential(
      ctx.tenantUserId,
      parsed.data.provider,
      parsed.data.apiKey,
    );
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
  if (!ctx.perms.canSettings) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  await removePaymentCredential(ctx.tenantUserId);
  return NextResponse.json({ ok: true });
}
