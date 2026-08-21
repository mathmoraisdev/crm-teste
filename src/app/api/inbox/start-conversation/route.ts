import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveOrCreateLeadByPhone } from "@/server/services/lead.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  phone: z.string().min(1, "Telefone obrigatório"),
  name: z.string().optional(),
  // null/omitido = o servidor escolhe o chip conectado primário.
  whatsAppNumberId: z.string().nullish(),
});

/**
 * "Nova conversa" no inbox: resolve/cria o lead pelo número e devolve o id p/ o
 * cliente abrir o chat direto (sem cadastrar antes nem precisar de inbound).
 * Aberto a qualquer operador da conta (igual ao POST /api/leads).
 */
export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  try {
    const { lead, created } = await resolveOrCreateLeadByPhone(ctx.tenantUserId, {
      phone: parsed.data.phone,
      name: parsed.data.name,
      whatsAppNumberId: parsed.data.whatsAppNumberId ?? null,
    });
    return NextResponse.json(
      { leadId: lead.id, created },
      { status: created ? 201 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao abrir a conversa" },
      { status: 400 },
    );
  }
}
