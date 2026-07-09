import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { rateLimit } from "@/lib/ratelimit";
import { placeOnlineOrder } from "@/server/services/online-order.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

const bodySchema = z.object({
  mode: z.enum(["DELIVERY", "RETIRADA"]),
  customerName: z.string().trim().min(1, "Informe seu nome."),
  customerPhone: z.string().trim().min(8, "Telefone inválido."),
  items: z
    .array(
      z.object({
        catalogItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        note: z.string().trim().max(280).optional(),
      }),
    )
    .min(1, "Carrinho vazio."),
  address: z
    .object({
      neighborhoodZoneId: z.string().optional(),
      street: z.string().optional(),
      number: z.string().optional(),
      complement: z.string().optional(),
      reference: z.string().optional(),
    })
    .optional(),
  payment: z.enum(["online", "on_delivery"]),
  note: z.string().trim().max(500).optional(),
});

// Erros de regra do serviço, prefixados "CODE:mensagem" → 409 (conflito de estado).
const KNOWN_CODES = ["STORE_CLOSED", "MODE_OFF", "ITEM_UNAVAILABLE", "ZONE_REQUIRED", "MIN_ORDER", "PAY_OFF", "EMPTY"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Rate-limit por IP+slug (15 pedidos/min — tolera oscilação, barrando abuso).
  const rl = await rateLimit(`menu:order:${clientIp(req)}:${slug}`, 15, 60);
  if (!rl.ok) {
    return NextResponse.json({ error: "Muitas tentativas. Tente em instantes." }, { status: 429 });
  }

  // Conta pelo slug + cardápio LIGADO (404 idêntico p/ inexistente/desligado).
  const account = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, menuEnabled: true },
  });
  if (!account || !account.menuEnabled) {
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
    const res = await placeOnlineOrder(account.id, parsed.data);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao registrar o pedido.";
    const code = msg.split(":")[0];
    const clean = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1) : msg;
    if (KNOWN_CODES.includes(code)) {
      return NextResponse.json({ error: clean, code }, { status: 409 });
    }
    return NextResponse.json({ error: "Erro ao registrar o pedido." }, { status: 400 });
  }
}
