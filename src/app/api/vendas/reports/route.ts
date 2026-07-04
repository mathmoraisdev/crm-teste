import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { resolvePeriod, type ReportPeriod } from "@/server/services/date-range";
import { salesSummary, revenueByPayment, revenueByOperator, topItems } from "@/server/services/sales-report.service";

export const dynamic = "force-dynamic";

const VALID: ReportPeriod[] = ["hoje", "7d", "mes"];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const raw = req.nextUrl.searchParams.get("period") ?? "hoje";
  const period = (VALID.includes(raw as ReportPeriod) ? raw : "hoje") as ReportPeriod;
  const { from, to } = resolvePeriod(period);
  const [summary, byPayment, byOperator, top] = await Promise.all([
    salesSummary(ctx.tenantUserId, from, to),
    revenueByPayment(ctx.tenantUserId, from, to),
    revenueByOperator(ctx.tenantUserId, from, to),
    topItems(ctx.tenantUserId, from, to, 10),
  ]);
  return NextResponse.json({ period, summary, byPayment, byOperator, topItems: top });
}
