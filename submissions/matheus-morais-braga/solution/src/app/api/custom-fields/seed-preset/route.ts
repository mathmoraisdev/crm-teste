import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { seedCustomFieldPreset } from "@/server/services/custom-field-preset.service";

const NO_SETTINGS_PERM =
  "Seu usuário não tem permissão para alterar as configurações da conta.";

export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  const userId = ctx.tenantUserId;
  const templateId = await getBusinessTemplateId(userId);
  if (!templateId) {
    return NextResponse.json({ error: "Sua conta não tem um ramo definido." }, { status: 400 });
  }
  try {
    const result = await seedCustomFieldPreset(userId, templateId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao semear campos" },
      { status: 400 },
    );
  }
}
