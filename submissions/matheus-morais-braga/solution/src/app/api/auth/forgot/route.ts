import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordReset } from "@/server/services/user.service";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().min(1, "Informe o e-mail."),
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

  // Best-effort: nunca revela se o e-mail existe nem falha por erro de envio.
  try {
    await createPasswordReset(parsed.data.email);
  } catch (e) {
    console.error("[forgot] falha ao criar reset de senha:", e);
  }

  // Resposta neutra sempre — não vaza existência da conta.
  return NextResponse.json({ ok: true });
}
