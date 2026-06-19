import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getCalendar } from "@/server/calendar";

/**
 * Diagnóstico de calendário: tenta listar a disponibilidade real e devolve os
 * slots OU o erro cru do provider (ex.: erro do Google Calendar). Serve para
 * descobrir, sem caçar log, por que o agendamento da IA falha em produção.
 * Acesse autenticado: GET /api/dev/calendar-check
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const cal = getCalendar();
    const slots = await cal.getAvailability({ count: 3 });
    return NextResponse.json({ ok: true, mode: cal.mode, slots });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
