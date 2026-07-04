import type { ExpenseCategory } from "@prisma/client";

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  ALUGUEL: "Aluguel",
  FORNECEDOR: "Fornecedor / Mercadoria",
  PESSOAL: "Salário / Pessoal",
  CONTAS: "Contas (luz/água/net)",
  IMPOSTOS: "Impostos / Taxas",
  OUTRO: "Outro",
};

export const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] =
  (Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).map((value) => ({ value, label: CATEGORY_LABEL[value] }));
