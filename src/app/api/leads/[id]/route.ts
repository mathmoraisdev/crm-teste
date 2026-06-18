import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LeadStatus } from "@prisma/client";
import { deleteLead, getLeadDetail, updateLead } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const lead = await getLeadDetail(id);
  if (!lead) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ lead });
}

const updateSchema = z
  .object({
    name: z.string().min(1, "Nome obrigatório").optional(),
    phone: z.string().min(1, "Telefone obrigatório").optional(),
    email: z.string().optional(),
    status: z.nativeEnum(LeadStatus).optional(),
    optOut: z.boolean().optional(),
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
    const lead = await updateLead(id, parsed.data);
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar lead" },
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
    await deleteLead(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao apagar lead" },
      { status: 400 },
    );
  }
}
