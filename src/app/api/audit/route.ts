import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listAudit } from "@/server/services/audit.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const parseDate = (v: string | null) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const res = await listAudit(ctx.tenantUserId, {
    entityType: sp.get("entityType") ?? undefined,
    actorId: sp.get("actorId") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
    cursor: sp.get("cursor") ?? undefined,
  });
  return NextResponse.json(res);
}
