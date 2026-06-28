import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { deleteAccount } from "@/server/services/user.service";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Exclui a conta do usuário logado (direito de eliminação — LGPD).
 * O cascade do schema remove leads/campanhas/mensagens/números/tokens.
 * Limpa o cookie de sessão ao final.
 *
 * Só o DONO (ADMIN) exclui a conta — é uma operação de ciclo de vida da conta
 * inteira. Operadores são removidos pelo admin em /equipe.
 */
export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta pode excluí-la." },
      { status: 403 },
    );
  }

  try {
    await deleteAccount(ctx.tenantUserId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao excluir a conta." },
      { status: 400 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
