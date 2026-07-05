import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getPosSettings, updatePosSettings } from "@/server/services/pos-settings.service";

export const dynamic = "force-dynamic";

// GET: qualquer usuário da conta lê (o operador no caixa precisa saber como imprimir).
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const settings = await getPosSettings(ctx.tenantUserId);
  return NextResponse.json({ settings });
}

// PATCH: só o dono/ADMIN configura a impressão da conta (como o branding).
export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const b = body as Record<string, unknown>;
  const patch: Parameters<typeof updatePosSettings>[1] = {};
  if (b.printMode === "browser" || b.printMode === "escpos") patch.printMode = b.printMode;
  if (typeof b.printerName === "string" || b.printerName === null) patch.printerName = (b.printerName as string | null) ?? null;
  if (typeof b.openDrawer === "boolean") patch.openDrawer = b.openDrawer;

  try {
    const settings = await updatePosSettings(ctx.tenantUserId, patch);
    return NextResponse.json({ settings });
  } catch (e) {
    console.error(`[pos-settings] upsert falhou: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Falha ao salvar configuração" }, { status: 500 });
  }
}
