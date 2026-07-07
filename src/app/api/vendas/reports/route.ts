import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { resolvePeriod, type ReportPeriod } from "@/server/services/date-range";
import { salesSummary, revenueByPayment, revenueByOperator, topItems, commissionByProfessional, salesMargin } from "@/server/services/sales-report.service";
import { expensesTotal, expensesByCategory } from "@/server/services/expense-report.service";

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

  const base = { period, summary, byPayment, byOperator, topItems: top };
  // Despesas/saldo/margem/comissão são financeiros. Operador sem canFinance recebe só as vendas.
  if (!ctx.perms.canFinance) return NextResponse.json(base);

  const [expTotal, expByCat, commissions, margin] = await Promise.all([
    expensesTotal(ctx.tenantUserId, from, to),
    expensesByCategory(ctx.tenantUserId, from, to),
    commissionByProfessional(ctx.tenantUserId, from, to),
    salesMargin(ctx.tenantUserId, from, to),
  ]);
  return NextResponse.json({
    ...base,
    expensesTotalCents: expTotal,
    expensesByCategory: expByCat,
    balanceCents: summary.totalCents - expTotal,
    commissionByProfessional: commissions,
    margin,
  });
}
