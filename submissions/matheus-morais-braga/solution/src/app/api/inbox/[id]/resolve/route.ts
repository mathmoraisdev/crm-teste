import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveConversation } from "@/server/services/inbox.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  returnToAi: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = resolveSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const lead = await resolveConversation(ctx.tenantUserId, id, {
      returnToAi: parsed.data.returnToAi,
    });
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao resolver conversa" },
      { status: 400 },
    );
  }
}
