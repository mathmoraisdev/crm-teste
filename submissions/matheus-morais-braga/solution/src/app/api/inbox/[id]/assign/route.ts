import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assignConversation } from "@/server/services/inbox.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  operatorId: z.string().optional(),
});

/** Assume a conversa. Sem `operatorId` atribui ao próprio operador logado. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = assignSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const lead = await assignConversation(
      ctx.tenantUserId,
      id,
      parsed.data.operatorId ?? ctx.sessionUserId,
      ctx.sessionUserId,
    );
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao assumir conversa" },
      { status: 400 },
    );
  }
}
