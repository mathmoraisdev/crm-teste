import { z } from "zod";
import { prisma } from "@/server/db/client";

export interface QuickReplyDTO {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  order: number;
}

function toDTO(o: {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  order: number;
}): QuickReplyDTO {
  return { id: o.id, title: o.title, body: o.body, shortcut: o.shortcut, order: o.order };
}

// Normaliza o atalho: sem "/" inicial, minúsculo, sem espaços. Vazio → null.
function normShortcut(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/^\/+/, "").toLowerCase();
  return s ? s : null;
}

const upsertSchema = z.object({
  title: z.string().trim().min(1, "Título obrigatório."),
  body: z.string().trim().min(1, "Corpo obrigatório."),
  shortcut: z.string().nullish(),
  order: z.number().int().min(0).optional(),
});

export async function listQuickReplies(userId: string): Promise<QuickReplyDTO[]> {
  const rows = await prisma.quickReply.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

export async function createQuickReply(
  userId: string,
  data: { title: string; body: string; shortcut?: string | null; order?: number },
): Promise<QuickReplyDTO> {
  const parsed = upsertSchema.parse(data);
  const shortcut = normShortcut(parsed.shortcut);
  if (shortcut) {
    const clash = await prisma.quickReply.findFirst({ where: { userId, shortcut }, select: { id: true } });
    if (clash) throw new Error("Já existe uma resposta rápida com esse atalho.");
  }
  const row = await prisma.quickReply.create({
    data: { userId, title: parsed.title, body: parsed.body, shortcut, order: parsed.order ?? 0 },
  });
  return toDTO(row);
}

export async function updateQuickReply(
  userId: string,
  id: string,
  data: { title?: string; body?: string; shortcut?: string | null; order?: number },
): Promise<QuickReplyDTO> {
  const owned = await prisma.quickReply.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Resposta rápida não encontrada.");
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) {
    const title = data.title.trim();
    if (!title) throw new Error("Título obrigatório.");
    patch.title = title;
  }
  if (data.body !== undefined) {
    const body = data.body.trim();
    if (!body) throw new Error("Corpo obrigatório.");
    patch.body = body;
  }
  if (data.shortcut !== undefined) {
    const shortcut = normShortcut(data.shortcut);
    if (shortcut) {
      const clash = await prisma.quickReply.findFirst({
        where: { userId, shortcut, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new Error("Já existe uma resposta rápida com esse atalho.");
    }
    patch.shortcut = shortcut;
  }
  if (data.order !== undefined) {
    if (!Number.isInteger(data.order) || data.order < 0) throw new Error("Ordem inválida.");
    patch.order = data.order;
  }
  const row = await prisma.quickReply.update({ where: { id }, data: patch });
  return toDTO(row);
}

export async function deleteQuickReply(userId: string, id: string): Promise<void> {
  const owned = await prisma.quickReply.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Resposta rápida não encontrada.");
  await prisma.quickReply.delete({ where: { id } });
}
