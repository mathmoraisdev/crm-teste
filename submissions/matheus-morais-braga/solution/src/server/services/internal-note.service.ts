import { prisma } from "@/server/db/client";

export interface InternalNoteDTO {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string };
}

/** Garante que o lead pertence à conta (tenant); lança se não. */
async function assertLeadInAccount(accountId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId: accountId },
    select: { id: true },
  });
  if (!lead) throw new Error("Conversa não encontrada.");
}

/** Lista as notas internas de uma conversa (mais antigas primeiro). */
export async function listNotes(accountId: string, leadId: string): Promise<InternalNoteDTO[]> {
  await assertLeadInAccount(accountId, leadId);
  const notes = await prisma.internalNote.findMany({
    where: { leadId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.createdAt,
    author: { id: n.author.id, name: n.author.name },
  }));
}

/**
 * Adiciona uma nota interna à conversa. Escopo por conta (o lead precisa ser da
 * conta). NUNCA envia nada ao cliente — só grava a nota.
 */
export async function addNote(
  accountId: string,
  leadId: string,
  authorId: string,
  body: string,
): Promise<InternalNoteDTO> {
  await assertLeadInAccount(accountId, leadId);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("A nota não pode ser vazia.");
  const note = await prisma.internalNote.create({
    data: { leadId, authorId, body: trimmed },
    include: { author: { select: { id: true, name: true } } },
  });
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    author: { id: note.author.id, name: note.author.name },
  };
}
