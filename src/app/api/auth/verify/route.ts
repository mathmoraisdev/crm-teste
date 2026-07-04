import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/server/services/user.service";

export const runtime = "nodejs";

/** Base absoluta para os redirects (sem barra final). */
function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Confirma o e-mail a partir do link enviado por e-mail (GET ?token=).
 * Em sucesso, redireciona para /leads; senão, para a página de status com erro.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = appUrl();

  if (!token) {
    return NextResponse.redirect(`${base}/verificar-email?status=erro`);
  }

  // verifyEmailToken toca o banco: se falhar (infra/schema), não estoura 500 —
  // loga e cai no redirect de erro, mesmo destino de token inválido.
  let ok = false;
  try {
    ok = await verifyEmailToken(token);
  } catch (e) {
    console.error(`[verify] falha ao validar token: ${e instanceof Error ? e.message : String(e)}`);
  }
  return NextResponse.redirect(
    ok ? `${base}/leads?verificado=1` : `${base}/verificar-email?status=erro`,
  );
}
