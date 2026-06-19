import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import {
  getAiCredentialStatus,
  saveAiCredential,
  removeAiCredential,
} from "@/server/services/ai-credential.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(["OPENAI", "ANTHROPIC"]),
  apiKey: z.string().min(12),
});

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json(await getAiCredentialStatus(userId));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    const status = await saveAiCredential(userId, parsed.data.provider, parsed.data.apiKey);
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar." },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  await removeAiCredential(userId);
  return NextResponse.json({ ok: true });
}
