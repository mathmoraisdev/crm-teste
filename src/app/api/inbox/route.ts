import { NextRequest, NextResponse } from "next/server";
import { inboxCounts, listConversations, type InboxFilter } from "@/server/services/inbox.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const FILTERS: InboxFilter[] = ["fila", "minhas", "ia", "todas", "resolvidas"];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const raw = req.nextUrl.searchParams.get("filter");
  const filter = (FILTERS.includes(raw as InboxFilter) ? raw : "todas") as InboxFilter;
  const [conversations, counts] = await Promise.all([
    listConversations(ctx.tenantUserId, { filter, sessionUserId: ctx.sessionUserId }),
    inboxCounts(ctx.tenantUserId, ctx.sessionUserId),
  ]);
  return NextResponse.json({ conversations, counts, me: ctx.sessionUserId });
}
