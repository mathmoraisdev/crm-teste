import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { WhatsAppNumberStatus } from "@prisma/client";
import {
  deleteWhatsAppNumber,
  updateWhatsAppNumber,
} from "@/server/services/numbers.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateSchema = z
  .object({
    label: z.string().min(1, "Informe um apelido").optional(),
    dailyCap: z.number().int().positive("Cap deve ser positivo").optional(),
    // só transições manuais; o service revalida o conjunto permitido
    status: z
      .enum([
        WhatsAppNumberStatus.CONNECTED,
        WhatsAppNumberStatus.PAUSED,
        WhatsAppNumberStatus.DISABLED,
      ])
      .optional(),
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
    await updateWhatsAppNumber(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar número" },
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
    await deleteWhatsAppNumber(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao remover número" },
      { status: 400 },
    );
  }
}
