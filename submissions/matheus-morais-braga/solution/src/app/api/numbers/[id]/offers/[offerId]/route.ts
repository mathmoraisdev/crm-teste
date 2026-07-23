import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantUserId } from "@/lib/tenant";
import { updateOffer, deleteOffer } from "@/server/services/offer.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateSchema = z
  .object({
    name: z.string().min(1, "Nome da oferta obrigatório").optional(),
    description: z.string().max(2000).nullish(),
    priceCents: z.number().int().min(100, "Preço mínimo é R$1,00").optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { offerId } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const offer = await updateOffer(userId, offerId, parsed.data);
    return NextResponse.json({ offer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar oferta" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { offerId } = await params;
  try {
    await deleteOffer(userId, offerId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao remover oferta" },
      { status: 400 },
    );
  }
}
