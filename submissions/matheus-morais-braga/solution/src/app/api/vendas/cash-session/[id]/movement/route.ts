import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { addMovement } from "@/server/services/cash-session.service";

export const dynamic = "force-dynamic";

const movementSchema = z.object({
  kind: z.enum(["SANGRIA", "SUPRIMENTO"]),
  amountCents: z.number().int().positive(),
  reason: z.string().nullish(),
});

// Sangria/suprimento: qualquer operador logado (registra na sessão da conta).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = movementSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    await addMovement(ctx.tenantUserId, id, parsed.data.kind, parsed.data.amountCents, parsed.data.reason ?? null, ctx.sessionUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
