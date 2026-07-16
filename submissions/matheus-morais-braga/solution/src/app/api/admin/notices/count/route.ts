import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { countUnseenNotices } from "@/server/services/notice.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contagem de avisos não lidos (cancelamentos/exclusões) para o badge do sidebar.
 * Só o admin da plataforma. Não-admin recebe 0 (não vaza a existência do recurso).
 */
export async function GET() {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;
  if (!me || !isAdminEmail(me.email)) {
    return NextResponse.json({ count: 0 });
  }
  const count = await countUnseenNotices();
  return NextResponse.json({ count });
}
