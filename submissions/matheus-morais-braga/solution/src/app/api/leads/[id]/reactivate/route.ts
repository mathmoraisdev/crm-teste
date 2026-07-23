import { NextRequest, NextResponse } from "next/server";
import { reactivateLead } from "@/server/services/lead.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Reativa um lead descartado/opt-out: volta o status para EM_CONVERSA e limpa o
 * opt-out numa só ação (destrava IA e outbound juntos). Reversão sempre manual
 * (LGPD): o operador assume conscientemente que o contato pode ser reabordado.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const lead = await reactivateLead(id, userId);
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao reativar lead" },
      { status: 400 },
    );
  }
}
