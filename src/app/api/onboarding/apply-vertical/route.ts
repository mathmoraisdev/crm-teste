import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { applyVertical } from "@/server/services/vertical-onboarding.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  templateId: z.string().min(1),
  numberId: z.string().nullish(),
  applyTheme: z.boolean().default(true),
  overwriteText: z.boolean().default(false),
});

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const result = await applyVertical(ctx.tenantUserId, {
      templateId: parsed.data.templateId,
      numberId: parsed.data.numberId ?? null,
      applyTheme: parsed.data.applyTheme,
      overwriteText: parsed.data.overwriteText,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao aplicar" }, { status: 400 });
  }
}
