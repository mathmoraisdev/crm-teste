import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { exportUserData } from "@/server/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exporta todos os dados da conta como download JSON (portabilidade LGPD).
 * Só o DONO (ADMIN): os dados (leads, campanhas, números) pertencem à conta dele;
 * a linha do operador não os contém.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta pode exportar os dados." },
      { status: 403 },
    );
  }

  try {
    const data = await exportUserData(ctx.tenantUserId);
    const filename = `disparador-ai-dados-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao exportar os dados." },
      { status: 400 },
    );
  }
}
