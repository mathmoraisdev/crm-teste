import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCampaign, listCampaigns } from "@/server/services/campaign.service";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const campaigns = await listCampaigns(userId);
  return NextResponse.json({ campaigns });
}

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  messageTemplate: z
    .string()
    .min(1, "Template obrigatório")
    .refine((t) => /\{\{\s*nome\s*\}\}/i.test(t), {
      message: "O template deve conter {{nome}}",
    }),
  leadIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  const result = await createCampaign(userId, parsed.data);
  return NextResponse.json(result, { status: 201 });
}
