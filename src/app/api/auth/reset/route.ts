import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/server/services/user.service";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(1, "Token ausente."),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
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
    await resetPassword(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Não foi possível redefinir a senha." },
      { status: 400 },
    );
  }
}
