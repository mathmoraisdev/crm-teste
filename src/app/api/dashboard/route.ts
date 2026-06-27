import { NextRequest, NextResponse } from "next/server";
import { getDashboard } from "@/server/services/dashboard.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const data = await getDashboard(userId, { days });
  return NextResponse.json({ data });
}
