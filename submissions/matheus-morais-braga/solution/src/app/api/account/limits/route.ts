import { NextResponse } from "next/server";
import { getAccountLimits } from "@/server/services/account.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Uso vs. teto do plano da conta (tenant) p/ o card "Limites" do dashboard. */
export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const limits = await getAccountLimits(userId);
  return NextResponse.json({ limits });
}
