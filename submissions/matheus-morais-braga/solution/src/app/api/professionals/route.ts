import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { createProfessional, listProfessionals } from "@/server/services/professional.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";
  const professionals = await listProfessionals(ctx.tenantUserId, { activeOnly });
  return NextResponse.json({ professionals });
}

const createSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  userId: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const professional = await createProfessional(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ professional });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
