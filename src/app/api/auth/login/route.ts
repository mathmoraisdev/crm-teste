import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
} from "@/lib/auth";
import { authenticateUser } from "@/server/services/user.service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  try {
    const auth = await authenticateUser(email, password);
    if (!auth) {
      return NextResponse.json(
        { error: "E-mail ou senha inválidos." },
        { status: 401 },
      );
    }

    const token = await signSession(auth.id, auth.sessionEpoch);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    // Falha de infra (banco fora do ar / schema não migrado → P2022) ou
    // SESSION_SECRET ausente em prod. Loga o erro REAL no runtime (Vercel) em
    // vez de estourar um 500 de corpo vazio, e devolve mensagem legível.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[login] falha inesperada: ${msg}`);
    return NextResponse.json(
      { error: "Erro interno ao entrar. Tente novamente em instantes." },
      { status: 500 },
    );
  }
}
