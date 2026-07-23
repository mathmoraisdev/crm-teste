import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { resolvePeriod, type ReportPeriod } from "@/server/services/date-range";
import { listSalesHistory, listSalesOperators } from "@/server/services/sales-history.service";

export const dynamic = "force-dynamic";
const VALID: ReportPeriod[] = ["hoje", "7d", "mes"];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;

  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  let from: Date, to: Date;
  if (fromRaw && toRaw) {
    from = new Date(fromRaw); to = new Date(toRaw);
    if (isNaN(+from) || isNaN(+to)) return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
  } else {
    const p = (VALID.includes(sp.get("period") as ReportPeriod) ? sp.get("period") : "mes") as ReportPeriod;
    ({ from, to } = resolvePeriod(p));
  }
  const operatorId = sp.get("operatorId") || undefined;
  const q = sp.get("q") || undefined;
  const skip = Number(sp.get("skip") ?? 0) || 0;
  const take = Math.min(Number(sp.get("take") ?? 50) || 50, 100);
  const includeCanceled = sp.get("includeCanceled") === "1";

  const [page, operators] = await Promise.all([
    listSalesHistory(ctx.tenantUserId, { from, to, operatorId, query: q, skip, take, includeCanceled }),
    listSalesOperators(ctx.tenantUserId),
  ]);
  return NextResponse.json({ ...page, operators });
}
