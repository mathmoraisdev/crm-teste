// src/app/api/admin/settings/route.ts
// Configurações globais do app (somente admin). Hoje: liga/desliga a landing na raiz.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { setLandingEnabled } from "@/server/services/settings.service";

export const runtime = "nodejs";

const schema = z.object({ landingEnabled: z.boolean() });

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;
  if (!me || !isAdminEmail(me.email)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  await setLandingEnabled(parsed.data.landingEnabled);
  return NextResponse.json({ ok: true });
}
