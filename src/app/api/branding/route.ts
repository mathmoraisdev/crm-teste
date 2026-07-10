import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { presetById } from "@/lib/theme/presets";
import { uploadBrandingLogo } from "@/server/storage/branding-storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const form = await req.formData();
  const presetId = (form.get("presetId") as string | null)?.trim() || null;
  const appName = (form.get("appName") as string | null)?.trim() || null;
  // Tema das páginas públicas: só "dark" liga o escuro; qualquer outra coisa = claro.
  const publicTheme = (form.get("publicTheme") as string | null) === "dark" ? "dark" : "light";
  // Endereço físico (texto livre); vazio → null. Cap defensivo p/ não virar campo aberto.
  const businessAddress = (form.get("businessAddress") as string | null)?.trim().slice(0, 300) || null;
  const file = form.get("logo") as File | null;

  const data: Record<string, unknown> = { appName, publicTheme, businessAddress };
  if (presetId) {
    const preset = presetById(presetId);
    if (!preset) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
    data.presetId = preset.id;
    data.brandScale = preset.palette;
  }
  if (file && file.size > 0) {
    if (file.size > 512 * 1024) return NextResponse.json({ error: "logo até 512KB" }, { status: 400 });
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : null;
    if (!ext) return NextResponse.json({ error: "use PNG, JPG ou WEBP" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const url = await uploadBrandingLogo(buf, { accountId: ctx.tenantUserId, ext, mime: file.type });
    if (url) data.logoUrl = url;
  }

  try {
    await prisma.accountBranding.upsert({
      where: { accountId: ctx.tenantUserId },
      create: { accountId: ctx.tenantUserId, ...data },
      update: data,
    });
  } catch (e) {
    // Simétrico ao getBranding: a falha aqui costuma ser a tabela ainda não
    // migrada em prod. Devolve mensagem legível em vez de 500 opaco (corpo vazio).
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[branding] upsert falhou: ${msg}`);
    return NextResponse.json({ error: "Falha ao salvar branding" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
