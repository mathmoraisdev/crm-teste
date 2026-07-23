import { NextResponse } from "next/server";
import { listMeetings } from "@/server/services/meeting.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const meetings = await listMeetings(userId);
  return NextResponse.json({ meetings });
}
