import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { setCancellation } from "@/server/services/account.service";

export const runtime = "nodejs";

const schema = z.object({ cancel: z.boolean() });

/**
 * Cancelamento self-service da assinatura (só o DONO/ADMIN). `cancel:true` pede
 * para não renovar; `cancel:false` reativa. NÃO corta acesso nem apaga dados — o
 * acesso segue até `accessUntil`; o pedido só sinaliza ao admin no /financeiro.
 * Para excluir a conta de vez (LGPD), use /api/account/delete.
 */
export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta pode gerenciar a assinatura." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    await setCancellation(ctx.tenantUserId, parsed.data.cancel);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar a assinatura." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
