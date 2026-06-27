// src/app/api/admin/accounts/[id]/billing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { setAccountAccess, type AccessAction } from "@/server/services/account.service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extend"), days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal("setUntil"), date: z.string().datetime() }),
  z.object({ kind: z.literal("forceActive") }),
  z.object({ kind: z.literal("forceSuspend") }),
  z.object({ kind: z.literal("auto") }),
  z.object({
    kind: z.literal("setInfo"),
    paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "TRANSFERENCIA"]).nullable(),
    paymentDueDate: z.string().datetime().nullable(),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  let action: AccessAction;
  if (parsed.data.kind === "setUntil") {
    action = { kind: "setUntil", date: new Date(parsed.data.date) };
  } else if (parsed.data.kind === "setInfo") {
    action = {
      kind: "setInfo",
      paymentMethod: parsed.data.paymentMethod,
      paymentDueDate: parsed.data.paymentDueDate ? new Date(parsed.data.paymentDueDate) : null,
    };
  } else {
    action = parsed.data as AccessAction;
  }

  const { id } = await params;
  try {
    await setAccountAccess(id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar." },
      { status: 400 },
    );
  }
}
