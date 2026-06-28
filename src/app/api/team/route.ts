import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { createOperator, listMembers } from "@/server/services/team.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome."),
  email: z.string().email("E-mail inválido."),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
  canCampaigns: z.boolean().optional(),
  canSettings: z.boolean().optional(),
  leadsScope: z.enum(["ALL", "ASSIGNED"]).optional(),
});

/** Lista os operadores da conta (só o ADMIN da conta). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }
  const members = await listMembers(ctx.tenantUserId);
  return NextResponse.json({ members });
}

/** Cria um operador na conta (só o ADMIN da conta). */
export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido." },
      { status: 400 },
    );
  }

  try {
    const { id } = await createOperator(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar usuário." },
      { status: 400 },
    );
  }
}
