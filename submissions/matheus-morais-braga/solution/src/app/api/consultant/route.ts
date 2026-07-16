import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildWhatsappUrl,
  createConsultantLead,
  notifyAdminsOfLead,
} from "@/server/services/consultant.service";

export const runtime = "nodejs";

// PÚBLICO (sem auth): a landing/página /consultor envia o prospect por aqui.
const schema = z.object({
  name: z.string().min(1, "Informe seu nome."),
  whatsapp: z.string().min(1, "Informe seu WhatsApp."),
  email: z.string().optional(),
  plan: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  try {
    const lead = await createConsultantLead(parsed.data);
    // Avisa os admins por e-mail. `notifyAdminsOfLead` nunca lança (sendEmail é
    // à prova de falha), então não protege a resposta do prospect.
    await notifyAdminsOfLead(lead);
    return NextResponse.json(
      { ok: true, whatsappUrl: buildWhatsappUrl(lead) },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao registrar contato." },
      { status: 400 },
    );
  }
}
