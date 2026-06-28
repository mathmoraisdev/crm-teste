import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { removeOperator, updateOperatorPerms } from "@/server/services/team.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    canCampaigns: z.boolean().optional(),
    canSettings: z.boolean().optional(),
    leadsScope: z.enum(["ALL", "ASSIGNED"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar." });

/** Atualiza as limitações de um operador (só o ADMIN da conta). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido." },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    await updateOperatorPerms(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar usuário." },
      { status: 400 },
    );
  }
}

/** Remove um operador da conta (só o ADMIN da conta). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { id } = await params;
  try {
    await removeOperator(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao remover usuário." },
      { status: 400 },
    );
  }
}
