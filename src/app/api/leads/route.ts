import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLead, listLeads } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const leads = await listLeads();
  return NextResponse.json({ leads });
}

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  phone: z.string().min(1, "Telefone obrigatório"),
  email: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const lead = await createLead(parsed.data.name, parsed.data.phone, parsed.data.email);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar lead" },
      { status: 400 },
    );
  }
}
