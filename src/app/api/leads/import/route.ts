import { NextRequest, NextResponse } from "next/server";
import { importLeadsFromCsv } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

/**
 * Aceita o CSV de duas formas:
 *  - multipart/form-data com campo "file"
 *  - text/csv ou text/plain no corpo cru
 */
export async function POST(req: NextRequest) {
  let content: string | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        content = await file.text();
      }
    } else {
      content = await req.text();
    }
  } catch {
    content = null;
  }

  if (!content || content.trim().length === 0) {
    return NextResponse.json(
      { error: "Nenhum conteúdo CSV recebido" },
      { status: 400 },
    );
  }

  const result = await importLeadsFromCsv(content);
  return NextResponse.json(result, { status: 200 });
}
