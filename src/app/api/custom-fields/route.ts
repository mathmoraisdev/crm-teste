import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CustomFieldType } from "@prisma/client";
import { createDef, listDefs } from "@/server/services/custom-field.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

const NO_SETTINGS_PERM =
  "Seu usuário não tem permissão para alterar as configurações da conta.";

const scopeSchema = z.enum(["LEAD", "ORDER", "ORDER_ITEM"]).catch("LEAD");

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const scope = scopeSchema.parse(req.nextUrl.searchParams.get("scope") ?? "LEAD");
  const defs = await listDefs(userId, scope);
  return NextResponse.json({ defs });
}

const createSchema = z.object({
  label: z.string().min(1, "Rótulo obrigatório"),
  type: z.nativeEnum(CustomFieldType),
  scope: z.enum(["LEAD", "ORDER", "ORDER_ITEM"]).default("LEAD"),
  options: z.array(z.string()).optional(),
  order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json({ error: NO_SETTINGS_PERM }, { status: 403 });
  }
  const userId = ctx.tenantUserId;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const def = await createDef(userId, parsed.data);
    return NextResponse.json({ def }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar campo" },
      { status: 400 },
    );
  }
}
