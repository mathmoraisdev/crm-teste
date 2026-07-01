import { NextRequest, NextResponse } from "next/server";
import { getDashboard } from "@/server/services/dashboard.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Parseia "YYYY-MM-DD" p/ Date. `end=true` → fim do dia (inclusivo). null se inválida. */
function parseDate(raw: string | null, end = false): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;

  // Intervalo explícito (De/Até) tem precedência sobre o preset `days`.
  const from = parseDate(sp.get("from"));
  const to = parseDate(sp.get("to"), true);
  if (from && to && from <= to) {
    const data = await getDashboard(userId, { from, to });
    return NextResponse.json({ data });
  }

  const daysParam = Number(sp.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const data = await getDashboard(userId, { days });
  return NextResponse.json({ data });
}
