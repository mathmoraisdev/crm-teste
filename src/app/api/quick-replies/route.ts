import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createQuickReply, listQuickReplies } from "@/server/services/quick-reply.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const quickReplies = await listQuickReplies(userId);
  return NextResponse.json({ quickReplies });
}

const createSchema = z.object({
  title: z.string().min(1, "Título obrigatório"),
  body: z.string().min(1, "Corpo obrigatório"),
  shortcut: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const quickReply = await createQuickReply(userId, parsed.data);
    return NextResponse.json({ quickReply }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar resposta rápida" },
      { status: 400 },
    );
  }
}
