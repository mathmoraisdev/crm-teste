import { NextResponse } from "next/server";
import { getClienteHistory } from "@/server/services/cliente.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const history = await getClienteHistory(ctx.tenantUserId, id);
  if (!history) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  return NextResponse.json(history);
}
