import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPipelineLabels, setPipelineLabels } from "@/server/services/account.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const labels = await getPipelineLabels(userId);
  return NextResponse.json({ labels });
}

const putSchema = z.object({
  labels: z.record(z.string(), z.string()),
});

export async function PUT(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const labels = await setPipelineLabels(userId, parsed.data.labels);
    return NextResponse.json({ labels });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar rótulos" },
      { status: 400 },
    );
  }
}
