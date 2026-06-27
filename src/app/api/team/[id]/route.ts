import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { removeOperator } from "@/server/services/team.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
