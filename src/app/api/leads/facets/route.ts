import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getLeadFacets } from "@/server/services/lead-facets.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const assignedToId = ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;
  return NextResponse.json(await getLeadFacets(ctx.tenantUserId, assignedToId));
}
