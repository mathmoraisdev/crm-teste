import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { LeadStatus } from "@prisma/client";
import { createLead, listLeads } from "@/server/services/lead.service";
import { getTenantUserId, getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  // Operador com escopo ASSIGNED só enxerga os leads atribuídos a ele.
  const assignedToId =
    ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;
  const sp = req.nextUrl.searchParams;
  const result = await listLeads(ctx.tenantUserId, {
    assignedToId,
    skip: Number(sp.get("skip") ?? 0) || 0,
    take: Number(sp.get("take") ?? 50) || 50,
    query: sp.get("q") ?? undefined,
    status: (sp.get("status") as LeadStatus | null) ?? undefined,
    campaignId: sp.get("campaignId") === "none" ? null : sp.get("campaignId") || undefined,
    optOut: sp.get("optOut") === null ? undefined : sp.get("optOut") === "true",
    tagId: sp.get("tagId") ?? undefined,
  });
  return NextResponse.json(result); // { items, total }
}

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  phone: z.string().min(1, "Telefone obrigatório"),
  email: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const lead = await createLead(userId, parsed.data.name, parsed.data.phone, parsed.data.email);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar lead" },
      { status: 400 },
    );
  }
}
