import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { WhatsAppNumberStatus } from "@prisma/client";
import {
  deleteWhatsAppNumber,
  updateWhatsAppNumber,
} from "@/server/services/numbers.service";
import { getCurrentUserId } from "@/lib/session";
import { ALL_AI_MODEL_VALUES } from "@/lib/ai-models";

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
    // ── config de atendimento (número = empresa) ──
    displayName: z.string().max(120).nullable().optional(),
    // modelo que opera a resposta; null = padrão. Validado contra o catálogo conhecido.
    aiModel: z
      .string()
      .refine((v) => ALL_AI_MODEL_VALUES.has(v), "Modelo de IA inválido")
      .nullable()
      .optional(),
    systemPromptOverride: z.string().max(20000).nullable().optional(), // prompt mestre completo
    persona: z.string().max(2000).nullable().optional(),
    knowledgeBase: z.string().max(8000).nullable().optional(), // teto p/ caber no prompt
    businessHours: z.string().max(500).nullable().optional(),
    customInstructions: z.string().max(2000).nullable().optional(),
    autoReplyEnabled: z.boolean().optional(),
    qualifyEnabled: z.boolean().optional(),
    scheduleEnabled: z.boolean().optional(),
    // timing & handoff
    replyDelaySeconds: z.number().int().min(0).max(600).optional(),
    firstReplyDelaySeconds: z.number().int().min(0).max(600).optional(),
    autoPauseOnHumanReply: z.boolean().optional(),
    inactivityResumeMinutes: z.number().int().min(0).max(1440).optional(),
    // silêncio > N min → IA zera o contexto (nova conversa). 0 = nunca zera. Teto 7 dias.
    contextResetMinutes: z.number().int().min(0).max(10080).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
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
    await updateWhatsAppNumber(id, userId, parsed.data);
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
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteWhatsAppNumber(id, userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao remover número" },
      { status: 400 },
    );
  }
}
