import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteCampaign, updateCampaign } from "@/server/services/campaign.service";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().min(1, "Nome obrigatório").optional(),
    messageTemplate: z
      .string()
      .min(1, "Template obrigatório")
      .refine((t) => /\{\{\s*nome\s*\}\}/i.test(t), {
        message: "O template deve conter {{nome}}",
      })
      .optional(),
    // null = volta ao default do env; número positivo = teto diário
    dailyCap: z.number().int().positive().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    await updateCampaign(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar campanha" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao apagar campanha" },
      { status: 400 },
    );
  }
}
