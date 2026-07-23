import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantUserId } from "@/lib/tenant";
import { listOffers, createOffer } from "@/server/services/offer.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1, "Nome da oferta obrigatório"),
  description: z.string().max(2000).nullish(),
  priceCents: z.number().int().min(100, "Preço mínimo é R$1,00"),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ offers: await listOffers(userId, id) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const offer = await createOffer(userId, { whatsAppNumberId: id, ...parsed.data });
    return NextResponse.json({ offer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar oferta" },
      { status: 400 },
    );
  }
}
