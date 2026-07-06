import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addNote, listNotes } from "@/server/services/internal-note.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Lista as notas internas da conversa. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const notes = await listNotes(ctx.tenantUserId, id);
    return NextResponse.json({ notes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao carregar notas" },
      { status: 400 },
    );
  }
}

const addSchema = z.object({
  body: z.string().min(1, "A nota não pode ser vazia."),
});

/** Adiciona uma nota interna (autor = operador logado). Nunca envia ao cliente. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const payload = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const note = await addNote(ctx.tenantUserId, id, ctx.sessionUserId, parsed.data.body);
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao adicionar nota" },
      { status: 400 },
    );
  }
}
