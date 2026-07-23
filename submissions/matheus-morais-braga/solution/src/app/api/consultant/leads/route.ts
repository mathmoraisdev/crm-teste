import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { listConsultantLeads } from "@/server/services/consultant.service";

export const dynamic = "force-dynamic";

/** E-mails admin do env (separados por vírgula), normalizados. */
function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await getUserById(userId);
  if (!user || !adminEmails().has(user.email.toLowerCase())) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }

  const leads = await listConsultantLeads();
  return NextResponse.json({ leads });
}
