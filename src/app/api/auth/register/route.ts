import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth";
import { registerUser, createEmailVerification } from "@/server/services/user.service";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(1, "Informe seu nome."),
  email: z.string().min(1, "Informe o e-mail."),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
  whatsapp: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  try {
    const { id } = await registerUser(parsed.data);
    // Dispara o e-mail de confirmação (best-effort: não bloqueia o cadastro).
    void createEmailVerification(id).catch((e) =>
      console.error("[register] falha ao enviar verificação de e-mail:", e),
    );
    const token = await signSession(id);
    const res = NextResponse.json({ ok: true }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar a conta." },
      { status: 400 },
    );
  }
}
