import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { deleteAccount } from "@/server/services/user.service";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Exclui a conta do usuário logado (direito de eliminação — LGPD).
 * O cascade do schema remove leads/campanhas/mensagens/números/tokens.
 * Limpa o cookie de sessão ao final.
 */
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    await deleteAccount(userId);
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
