import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { setAccountBilling } from "@/server/services/account.service";

export const runtime = "nodejs";

const schema = z.object({ active: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Guarda de admin (server-side — não confiar no front).
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

  const { id } = await params;
  try {
    const updated = await setAccountBilling(id, parsed.data.active);
    return NextResponse.json({ ok: true, billingActive: updated.billingActive });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar." },
      { status: 400 },
    );
  }
}
