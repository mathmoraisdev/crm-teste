import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { exportUserData } from "@/server/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exporta todos os dados da conta como download JSON (portabilidade LGPD).
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const data = await exportUserData(userId);
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
