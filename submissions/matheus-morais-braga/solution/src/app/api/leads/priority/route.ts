import { NextRequest, NextResponse } from "next/server";
import type { LeadStatus } from "@prisma/client";
import { listLeads } from "@/server/services/lead.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * GET /api/leads/priority
 *
 * Endpoint dedicado ao dashboard de priorização do vendedor.
 * Retorna leads ordenados por score descendente (quem ligar primeiro),
 * com a justificativa da IA inclusa em cada item.
 *
 * Query params:
 *   status  → multi-valor: ?status=QUALIFICADO&status=EM_CONVERSA
 *             Padrão: todos exceto DESCARTADO e PAGO
 *   skip    → paginação (default 0)
 *   take    → tamanho da página (default 50, cap 100)
 *
 * Reutiliza listLeads() com orderBy=score e onlyScored=true para não
 * poluir a lista com leads que ainda não passaram pela IA.
 */
const DEFAULT_STATUSES: LeadStatus[] = [
  "NOVO",
  "CONTATADO",
  "EM_CONVERSA",
  "QUALIFICADO",
  "REUNIAO_AGENDADA",
  "OFERTA_ENVIADA",
];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Operadores com escopo ASSIGNED só enxergam os próprios leads.
  const assignedToId =
    ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;

  const sp = req.nextUrl.searchParams;

  // Aceita multi-valor: ?status=QUALIFICADO&status=EM_CONVERSA
  const rawStatuses = sp.getAll("status") as LeadStatus[];
  const statuses = rawStatuses.length > 0 ? rawStatuses : DEFAULT_STATUSES;

  const result = await listLeads(ctx.tenantUserId, {
    assignedToId,
    statuses,
    orderBy: "score",
    onlyScored: true,
    skip: Number(sp.get("skip") ?? 0) || 0,
    take: Number(sp.get("take") ?? 50) || 50,
  });

  return NextResponse.json(result);
}
