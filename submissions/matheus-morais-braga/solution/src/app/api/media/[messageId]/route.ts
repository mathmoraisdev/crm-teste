import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getTenantContext } from "@/lib/tenant";
import { createMediaSignedUrl } from "@/server/storage/media-storage";

export const dynamic = "force-dynamic";

/**
 * Download de uma mídia (imagem/PDF) recebida do lead. O arquivo está num bucket
 * PRIVADO no Supabase; aqui geramos uma URL assinada de curta duração e
 * redirecionamos o navegador. Mesma permissão do inbox:
 *  - precisa estar logado (getTenantContext);
 *  - a mensagem precisa pertencer a um lead DA CONTA do usuário (tenant);
 *  - operador com leadsScope=ASSIGNED só baixa de leads atribuídos a ele.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { messageId } = await params;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      mediaPath: true,
      lead: { select: { userId: true, assignedToId: true } },
    },
  });

  // 404 genérico: não revela existência de mensagem de outra conta.
  if (!message || message.lead.userId !== ctx.tenantUserId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  // Operador com escopo restrito só acessa mídia dos leads dele.
  if (
    ctx.perms.leadsScope === "ASSIGNED" &&
    message.lead.assignedToId !== ctx.sessionUserId
  ) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }
  if (!message.mediaPath) {
    return NextResponse.json({ error: "Sem arquivo" }, { status: 404 });
  }

  const url = await createMediaSignedUrl(message.mediaPath, 300);
  if (!url) {
    return NextResponse.json(
      { error: "Storage de mídia indisponível" },
      { status: 503 },
    );
  }
  return NextResponse.redirect(url, 302);
}
