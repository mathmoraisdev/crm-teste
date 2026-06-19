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

  const ok = await verifyEmailToken(token);
  return NextResponse.redirect(
    ok ? `${base}/leads?verificado=1` : `${base}/verificar-email?status=erro`,
  );
}
