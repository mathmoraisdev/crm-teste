import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { seedOffersFromTemplate } from "@/server/services/offer.service";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const templateId = await getBusinessTemplateId(ctx.tenantUserId);
  if (!templateId) return NextResponse.json({ error: "Sua conta não tem um ramo definido." }, { status: 400 });
  try {
    return NextResponse.json(await seedOffersFromTemplate(ctx.tenantUserId, id, templateId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao semear ofertas" }, { status: 400 });
  }
}
