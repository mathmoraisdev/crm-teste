import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { createEmailVerification } from "@/server/services/user.service";

export const runtime = "nodejs";

/** Reenvia o e-mail de confirmação para o usuário logado (best-effort). */
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    await createEmailVerification(userId);
  } catch (e) {
    console.error("[resend-verification] falha ao reenviar verificação:", e);
  }

  return NextResponse.json({ ok: true });
}
