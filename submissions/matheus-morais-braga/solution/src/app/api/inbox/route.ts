import { NextRequest, NextResponse } from "next/server";
import {
  inboxCounts,
  listAccountNumbers,
  listConversations,
  type InboxFilter,
} from "@/server/services/inbox.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const FILTERS: InboxFilter[] = ["fila", "minhas", "ia", "todas", "resolvidas"];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const raw = req.nextUrl.searchParams.get("filter");
  const filter = (FILTERS.includes(raw as InboxFilter) ? raw : "todas") as InboxFilter;
  // Seletor de número: vazio/"todos" = sem filtro (mostra todos os chips juntos).
  const number = req.nextUrl.searchParams.get("number")?.trim() || undefined;
  const [conversations, counts, numbers] = await Promise.all([
    listConversations(ctx.tenantUserId, {
      filter,
      sessionUserId: ctx.sessionUserId,
      whatsAppNumberId: number,
    }),
    inboxCounts(ctx.tenantUserId, ctx.sessionUserId, number),
    listAccountNumbers(ctx.tenantUserId),
  ]);
  return NextResponse.json({ conversations, counts, numbers, me: ctx.sessionUserId });
}
