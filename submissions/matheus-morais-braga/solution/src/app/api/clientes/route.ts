import { NextRequest, NextResponse } from "next/server";
import { listClientes } from "@/server/services/cliente.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  // Operador com escopo ASSIGNED só enxerga os clientes atribuídos a ele.
  const assignedToId =
    ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;
  const sp = req.nextUrl.searchParams;
  const result = await listClientes(ctx.tenantUserId, {
    assignedToId,
    query: sp.get("q") ?? undefined,
    skip: Number(sp.get("skip") ?? 0) || 0,
    take: Number(sp.get("take") ?? 50) || 50,
  });
  return NextResponse.json(result); // { items, total }
}
