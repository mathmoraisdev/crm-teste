import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteQuickReply, updateQuickReply } from "@/server/services/quick-reply.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    title: z.string().min(1, "Título obrigatório").optional(),
    body: z.string().min(1, "Corpo obrigatório").optional(),
    shortcut: z.string().nullish(),
    order: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para gerenciar respostas rápidas." },
      { status: 403 },
    );
  }
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
    const quickReply = await updateQuickReply(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ quickReply });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar resposta rápida" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para gerenciar respostas rápidas." },
      { status: 403 },
    );
  }
  const { id } = await params;
  try {
    await deleteQuickReply(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao apagar resposta rápida" },
      { status: 400 },
    );
  }
}
