import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow } from "@/lib/sendWindow";
import { processNextJob, sentToday } from "@/server/worker/dispatcher";

export const dynamic = "force-dynamic";
// Drena a fila num único invoke. Hobby permite até 60s; reduza se necessário.
export const maxDuration = 60;

// Teto de jobs por execução — evita loop longo demais no serverless (timeout/custo).
const MAX_PER_RUN = 50;

/**
 * Cron de disparo — alternativa "100% Vercel" ao worker dedicado, válida SOMENTE
 * para WHATSAPP_MODE=mock | cloud-api (envio stateless por HTTP).
 *
 * NÃO funciona para `baileys`: aquele modo exige um processo eterno mantendo o
 * socket do WhatsApp vivo em memória + a sessão em disco — coisas que uma função
 * serverless (sobe e morre a cada chamada) não consegue. Para Baileys, rode o
 * worker (`npm run worker`) num host de processo longo (Railway/Render/VPS).
 *
 * Disparo: a Vercel Cron chama via GET com `Authorization: Bearer $CRON_SECRET`.
 * O RITMO de envio é controlado pela frequência do cron (vercel.json) + os caps,
 * não por sleep aqui dentro (sleep em serverless = custo e risco de timeout).
 */
export async function GET(req: NextRequest) {
  // Autorização: só a Vercel Cron (ou você, com o segredo). Se CRON_SECRET estiver
  // vazio, a rota fica aberta — defina-o sempre em produção.
  if (env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  if (env.WHATSAPP_MODE === "baileys") {
    return NextResponse.json(
      { error: "baileys exige o worker dedicado (socket vivo); o cron não mantém conexão" },
      { status: 409 },
    );
  }

  const now = new Date();
  const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);
  if (
    !isWithinWindow(hour, {
      startHour: env.WHATSAPP_SEND_START_HOUR,
      endHour: env.WHATSAPP_SEND_END_HOUR,
    })
  ) {
    return NextResponse.json({ sent: 0, skipped: "fora da janela comercial", hour });
  }

  const already = await sentToday(now);
  const deadline = Date.now() + (maxDuration - 5) * 1000; // margem antes do timeout

  let sent = 0;
  let reason = "fila vazia";
  while (sent < MAX_PER_RUN) {
    if (already + sent >= env.WHATSAPP_DAILY_CAP) {
      reason = "cap diário global";
      break;
    }
    if (Date.now() >= deadline) {
      reason = "deadline do invoke";
      break;
    }
    const ok = await processNextJob(now);
    if (!ok) break; // fila vazia (ou job perdido para outro processo)
    sent++;
  }
  if (sent >= MAX_PER_RUN) reason = "teto por execução";

  return NextResponse.json({ sent, reason });
}
