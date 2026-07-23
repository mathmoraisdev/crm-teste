import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setLeadTags } from "@/server/services/tag.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  tagIds: z.array(z.string()),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    await setLeadTags(userId, id, parsed.data.tagIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar tags do lead" },
      { status: 400 },
    );
  }
}
