import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { getCatalogPublicUrl } from "@/server/storage/catalog-storage";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { photoId } = await params;
  const photo = await prisma.catalogItemPhoto.findUnique({
    where: { id: photoId },
    select: { mediaPath: true, catalogItem: { select: { accountId: true } } },
  });
  if (!photo || photo.catalogItem.accountId !== ctx.tenantUserId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  // URL pública (bucket público + CDN) — antes era signed URL gerada por request.
  const url = getCatalogPublicUrl(photo.mediaPath);
  if (!url) return NextResponse.json({ error: "Storage de mídia indisponível" }, { status: 503 });
  return NextResponse.redirect(url, 302);
}
