import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Health do worker: compara o último heartbeat com agora. Sem heartbeat (worker
 * nunca subiu) ou heartbeat velho (acima de WORKER_HEARTBEAT_STALE_MS) → 503.
 */
export async function GET() {
  const hb = await prisma.workerHeartbeat.findUnique({ where: { id: "singleton" } });
  const now = Date.now();
  const ageMs = hb ? now - hb.beatAt.getTime() : null;
  const ok = ageMs !== null && ageMs <= env.WORKER_HEARTBEAT_STALE_MS;
  return NextResponse.json(
    { ok, beatAt: hb?.beatAt ?? null, ageMs, staleMs: env.WORKER_HEARTBEAT_STALE_MS },
    { status: ok ? 200 : 503 },
  );
}
