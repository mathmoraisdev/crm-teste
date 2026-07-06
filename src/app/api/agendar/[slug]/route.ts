import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { confirmBooking } from "@/server/services/booking-availability.service";

// PÚBLICO (sem auth): o widget de /agendar/<slug> confirma a marcação por aqui.
// A porta pública é a allowlist do middleware; aqui só resolvemos a conta pelo slug
// (+ bookingEnabled) e delegamos ao confirmBooking (que revalida e trava o slot).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  catalogItemId: z.string().min(1, "Serviço obrigatório."),
  // O slot ofertado sempre carrega um profissional concreto (inclusive no modo
  // "sem preferência", resolvido na listagem) — por isso é obrigatório aqui.
  professionalId: z.string().min(1, "Profissional obrigatório."),
  startISO: z.string().datetime({ message: "Horário inválido." }),
  customerName: z.string().trim().min(1, "Informe seu nome."),
  customerPhone: z.string().trim().min(8, "Informe um telefone válido."),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { rateLimit } = await import("@/lib/ratelimit");
  const rl = await rateLimit(`booking:confirm:${clientIp(req)}:${slug}`, 20, 60);
  if (!rl.ok) {
    return NextResponse.json({ error: "Muitas tentativas. Tente em instantes." }, { status: 429 });
  }

  // 404 idêntico p/ "não existe" e "existe mas desligado" — não vaza a conta.
  const account = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, bookingEnabled: true },
  });
  if (!account || !account.bookingEnabled) {
    return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  try {
    await confirmBooking(account.id, parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao confirmar.";
    // Conflito/expediente → 409 (a UI recarrega os slots do dia). `kind` ajuda a UI.
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: "Esse horário acabou de ser preenchido.", kind: "conflict" },
        { status: 409 },
      );
    }
    if (msg.startsWith("OUTSIDE_HOURS:")) {
      return NextResponse.json(
        { error: "Esse horário não está mais disponível.", kind: "conflict" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
