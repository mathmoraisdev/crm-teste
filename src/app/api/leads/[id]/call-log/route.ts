import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LeadStatus } from "@prisma/client";
import { getTenantContext } from "@/lib/tenant";
import { addNote } from "@/server/services/internal-note.service";
import { updateLead } from "@/server/services/lead.service";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Outcomes de uma ligação manual do vendedor.
 *
 * ANSWERED      — lead atendeu (conversa aconteceu)
 * NO_ANSWER     — não atendeu, sem próximo passo definido
 * CALLBACK      — não atendeu, vendedor agendou retorno p/ uma data/hora
 */
const CALL_OUTCOMES = ["ANSWERED", "NO_ANSWER", "CALLBACK"] as const;
type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Rótulo pt-BR que vai no prefixo da nota interna. */
const OUTCOME_LABEL: Record<CallOutcome, string> = {
  ANSWERED:  "📞 Atendeu",
  NO_ANSWER: "📵 Não atendeu",
  CALLBACK:  "📅 Retorno agendado",
};

/**
 * Mapeamento de outcome → novo status do lead (quando fizer sentido avançar).
 * null = não altera o status atual.
 *
 * - ANSWERED: avança para CONTATADO se ainda está em NOVO (1ª conversa real).
 *   Se já está em estágio mais avançado, preserva (o vendedor pode ter ligado
 *   para um lead QUALIFICADO — não queremos regredir).
 * - NO_ANSWER / CALLBACK: não altera — o lead não interagiu, não mudou de etapa.
 */
const OUTCOME_STATUS_ADVANCE: Record<CallOutcome, LeadStatus | null> = {
  ANSWERED:  "CONTATADO",
  NO_ANSWER: null,
  CALLBACK:  null,
};

const callLogSchema = z
  .object({
    /** Resultado da ligação. */
    outcome: z.enum(CALL_OUTCOMES),
    /**
     * Nota livre do vendedor sobre o que foi dito / combinado.
     * Opcional — se vazia, a nota ainda é criada com o prefixo do outcome.
     */
    note: z.string().max(1000).optional(),
    /**
     * Data/hora de retorno (ISO 8601). Obrigatório quando outcome = CALLBACK.
     * Salvo na nota para o vendedor ter o registro; sem backend de agendamento
     * nesta versão (o follow-up vive na nota, não num campo estruturado).
     */
    callbackAt: z.string().datetime({ offset: true }).optional(),
  })
  // Boundary de confiança: o modal valida no client, mas a API precisa rejeitar
  // um CALLBACK sem data — senão cria nota "📅 Retorno agendado" sem quando.
  .refine((d) => d.outcome !== "CALLBACK" || !!d.callbackAt, {
    path: ["callbackAt"],
    message: "Data/hora de retorno é obrigatória quando o resultado é 'Agendar retorno'.",
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id: leadId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = callLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  const { outcome, note, callbackAt } = parsed.data;

  // Monta o corpo da nota interna.
  // Exemplo: "📞 Atendeu — Lead confirmou interesse no plano premium. Enviar proposta na 6ª."
  const parts: string[] = [OUTCOME_LABEL[outcome]];

  if (outcome === "CALLBACK" && callbackAt) {
    const when = new Date(callbackAt).toLocaleString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
    parts.push(`— retornar em ${when}`);
  }

  if (note?.trim()) {
    parts.push(`— ${note.trim()}`);
  }

  const body_note = parts.join(" ");

  try {
    // 1. Persiste a nota interna (append-only, nunca vai ao cliente).
    await addNote(ctx.tenantUserId, leadId, ctx.sessionUserId, body_note);

    // 2. Avança o status do lead (apenas quando ANSWERED e o lead ainda está NOVO).
    const targetStatus = OUTCOME_STATUS_ADVANCE[outcome];
    if (targetStatus) {
    // Busca direto sem carregar a conversa inteira — só o status importa aqui.
    const current = await prisma.lead.findFirst({
      where: { id: leadId, userId: ctx.tenantUserId },
      select: { status: true },
    });
      // Só avança se ainda está em NOVO — não regride leads já em etapas superiores.
      if (current?.status === "NOVO") {
        await updateLead(
          leadId,
          ctx.tenantUserId,
          { status: targetStatus },
          ctx.sessionUserId,
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao registrar ligação" },
      { status: 400 },
    );
  }
}
