import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { ExpenseCategory, ExpenseStatus } from "@prisma/client";

export interface ExpenseDTO {
  id: string;
  description: string;
  amountCents: number;
  category: ExpenseCategory;
  status: ExpenseStatus;
  dueDate: string;
  paidAt: string | null;
  note: string | null;
  recurringId: string | null;
}

const CATEGORIES = ["ALUGUEL", "FORNECEDOR", "PESSOAL", "CONTAS", "IMPOSTOS", "OUTRO"] as const;

const createSchema = z.object({
  description: z.string().trim().min(1, "Descrição obrigatória."),
  amountCents: z.number().int().min(0, "Valor não pode ser negativo."),
  category: z.enum(CATEGORIES).default("OUTRO"),
  dueDate: z.string().min(1, "Vencimento obrigatório."), // "YYYY-MM-DD"
  note: z.string().trim().optional(),
});

/** "YYYY-MM-DD" → Date ao meio-dia local (estável longe da borda de dia). */
function parseDueDate(s: string): Date {
  const d = new Date(`${s}T12:00:00-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Data de vencimento inválida.");
  return d;
}

function toDTO(o: {
  id: string; description: string; amountCents: number; category: ExpenseCategory;
  status: ExpenseStatus; dueDate: Date; paidAt: Date | null; note: string | null; recurringId: string | null;
}): ExpenseDTO {
  return {
    id: o.id, description: o.description, amountCents: o.amountCents, category: o.category,
    status: o.status, dueDate: o.dueDate.toISOString(), paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    note: o.note, recurringId: o.recurringId,
  };
}

export async function createExpense(
  accountId: string,
  data: { description: string; amountCents: number; category?: ExpenseCategory; dueDate: string; note?: string; createdById: string; paidNow?: boolean },
): Promise<ExpenseDTO> {
  const parsed = createSchema.parse(data);
  const e = await prisma.expense.create({
    data: {
      accountId,
      description: parsed.description,
      amountCents: parsed.amountCents,
      category: parsed.category,
      dueDate: parseDueDate(parsed.dueDate),
      note: parsed.note || null,
      createdById: data.createdById,
      status: data.paidNow ? "PAGA" : "PENDENTE",
      paidAt: data.paidNow ? new Date() : null,
    },
  });
  return toDTO(e);
}

export async function listPayable(accountId: string): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: { accountId, status: "PENDENTE" },
    orderBy: { dueDate: "asc" },
  });
  return rows.map(toDTO);
}

export async function listPaid(accountId: string, limit = 100): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: { accountId, status: "PAGA" },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
  return rows.map(toDTO);
}

async function loadOwned(accountId: string, id: string) {
  const e = await prisma.expense.findFirst({ where: { id, accountId } });
  if (!e) throw new Error("Despesa não encontrada.");
  return e;
}

export async function payExpense(accountId: string, id: string): Promise<ExpenseDTO> {
  const owned = await loadOwned(accountId, id);
  if (owned.status === "PAGA") throw new Error("Despesa já está paga."); // não re-escreve paidAt
  const e = await prisma.expense.update({ where: { id }, data: { status: "PAGA", paidAt: new Date() } });
  return toDTO(e);
}

export async function updateExpense(
  accountId: string,
  id: string,
  data: { description?: string; amountCents?: number; category?: ExpenseCategory; dueDate?: string; note?: string | null },
): Promise<ExpenseDTO> {
  await loadOwned(accountId, id);
  const patch: Record<string, unknown> = {};
  if (data.description !== undefined) {
    const d = data.description.trim();
    if (!d) throw new Error("Descrição obrigatória.");
    patch.description = d;
  }
  if (data.amountCents !== undefined) {
    if (!Number.isInteger(data.amountCents) || data.amountCents < 0) throw new Error("Valor inválido.");
    patch.amountCents = data.amountCents;
  }
  if (data.category !== undefined) patch.category = data.category;
  if (data.dueDate !== undefined) patch.dueDate = parseDueDate(data.dueDate);
  if (data.note !== undefined) patch.note = data.note?.trim() || null;
  const e = await prisma.expense.update({ where: { id }, data: patch });
  return toDTO(e);
}

export async function deleteExpense(accountId: string, id: string): Promise<void> {
  await loadOwned(accountId, id);
  await prisma.expense.delete({ where: { id } });
}
