import { NextResponse } from "next/server";
import { listWhatsAppNumbers } from "@/server/services/numbers.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const numbers = await listWhatsAppNumbers();
  return NextResponse.json({ numbers });
}
