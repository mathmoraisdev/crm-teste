import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteTag, updateTag } from "@/server/services/tag.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().min(1, "Nome obrigatório").optional(),
    color: z.string().min(1, "Cor obrigatória").optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const tag = await updateTag(userId, id, parsed.data);
    return NextResponse.json({ tag });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar tag" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteTag(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao apagar tag" },
      { status: 400 },
    );
  }
}
