import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CustomFieldType } from "@prisma/client";
import { deleteDef, updateDef } from "@/server/services/custom-field.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    label: z.string().min(1, "Rótulo obrigatório").optional(),
    type: z.nativeEnum(CustomFieldType).optional(),
    options: z.array(z.string()).optional(),
    order: z.number().int().optional(),
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
    const def = await updateDef(userId, id, parsed.data);
    return NextResponse.json({ def });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar campo" },
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
    await deleteDef(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao apagar campo" },
      { status: 400 },
    );
  }
}
