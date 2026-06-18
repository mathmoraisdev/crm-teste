import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  getExpectedCredentials,
  signSession,
} from "@/lib/auth";

export const runtime = "nodejs";

/** Compara via hash SHA-256 (tempo constante, sem vazar tamanho). */
function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function POST(req: NextRequest) {
  if (!process.env.SESSION_SECRET) {
    return NextResponse.json(
      { error: "Autenticação não configurada no servidor." },
      { status: 500 },
    );
  }

  const { user: expectedUser, pass: expectedPass } = getExpectedCredentials();
  if (!expectedUser || !expectedPass) {
    return NextResponse.json(
      { error: "Autenticação não configurada no servidor." },
      { status: 500 },
    );
  }

  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = String(body?.username ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  // Avalia ambos sempre (não faz curto-circuito) p/ não revelar qual campo errou.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  if (!userOk || !passOk) {
    return NextResponse.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const token = await signSession(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
