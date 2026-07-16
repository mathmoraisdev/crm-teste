import { NextRequest, NextResponse } from "next/server";
import { getTenantUserId } from "@/lib/tenant";
import { deleteMediaAsset } from "@/server/services/media-asset.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Remove um asset da biblioteca da conta (escopado). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteMediaAsset(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao remover mídia" },
      { status: 400 },
    );
  }
}
