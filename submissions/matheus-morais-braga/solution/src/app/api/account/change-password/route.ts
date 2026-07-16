import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { changePassword } from "@/server/services/user.service";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth";

export const runtime = "nodejs";

const schema = z.object({
  currentPassword: z.string().min(1, "Informe sua senha atual."),
  newPassword: z.string().min(8, "A nova senha precisa ter ao menos 8 caracteres."),
});

/** Troca a senha do usuário logado (exige a senha atual). */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  try {
    const { sessionEpoch } = await changePassword(
      userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    // Re-assina o cookie deste dispositivo com o novo epoch: as OUTRAS sessões
    // (epoch antigo) caem, mas a atual continua válida.
    const token = await signSession(userId, sessionEpoch);
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Não foi possível alterar a senha." },
      { status: 400 },
    );
  }
}
