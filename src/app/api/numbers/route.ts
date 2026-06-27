import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { normalizePhone } from "@/lib/phone";
import { listWhatsAppNumbers, assertNumberQuota } from "@/server/services/numbers.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const [numbers, user] = await Promise.all([
    listWhatsAppNumbers(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { aiProvider: true } }),
  ]);
  // converte o QR cru em data URL p/ a UI renderizar como <img>
  const withQr = await Promise.all(
    numbers.map(async ({ pairingQr, ...n }) => ({
      ...n,
      qrDataUrl: pairingQr ? await QRCode.toDataURL(pairingQr, { margin: 1, width: 240 }) : null,
    })),
  );
  // provider efetivo p/ a UI adaptar o catálogo de modelos (BYOK ou plataforma=OPENAI)
  const provider = user?.aiProvider ?? "OPENAI";
  return NextResponse.json({ numbers: withQr, mode: env.WHATSAPP_MODE, provider });
}

const createSchema = z.object({
  label: z.string().min(1, "Informe um apelido (ex.: chip-01)"),
  phone: z.string().min(1, "Informe o número do chip"),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta gerencia os números." },
      { status: 403 },
    );
  }
  const userId = ctx.tenantUserId;
  if (env.WHATSAPP_MODE !== "baileys") {
    return NextResponse.json(
      { error: "Pareamento por QR só está disponível com WHATSAPP_MODE=baileys." },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "Número inválido (use E.164, ex.: +5511...)" }, { status: 400 });
  }
  // Entitlements: respeita o teto de números do plano (grandfather/admin = sem limite).
  try {
    await assertNumberQuota(userId, phone);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Limite de números atingido." },
      { status: 400 },
    );
  }
  const label = parsed.data.label.trim();
  const slug = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
  // sessionDir é global (filesystem): prefixa com a conta p/ não colidir entre usuários.
  const sessionDir = `${userId}__${slug}`;

  // CONNECTING + limpa QR antigo → o worker gera um novo QR e grava em pairingQr.
  const rec = await prisma.whatsAppNumber.upsert({
    where: { userId_phone: { userId, phone } },
    update: { label, sessionDir, status: "CONNECTING", pairingQr: null, lastError: null },
    create: {
      userId,
      label,
      phone,
      sessionDir,
      status: "CONNECTING",
      dailyCap: env.BAILEYS_PER_NUMBER_DAILY_CAP,
    },
  });
  return NextResponse.json({ id: rec.id }, { status: 201 });
}
