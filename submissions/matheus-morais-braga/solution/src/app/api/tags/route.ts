import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createTag, listTags } from "@/server/services/tag.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const tags = await listTags(userId);
  return NextResponse.json({ tags });
}

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  color: z.string().min(1, "Cor obrigatória"),
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
    const tag = await createTag(userId, parsed.data.name, parsed.data.color);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar tag" },
      { status: 400 },
    );
  }
}
