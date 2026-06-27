import { NextResponse } from "next/server";
import { listMeetings } from "@/server/services/meeting.service";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const meetings = await listMeetings(userId);
  return NextResponse.json({ meetings });
}
