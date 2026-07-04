-- Cria Expense/RecurringExpense (despesas e contas a pagar do módulo Caixa).
-- Aplicar em PROD manualmente (Supabase SQL Editor) — cutover p/ migrate pendente.
-- Idempotente e ADITIVO. Bate com o DDL gerado pelo Prisma.

DO $$ BEGIN CREATE TYPE "ExpenseCategory" AS ENUM ('ALUGUEL','FORNECEDOR','PESSOAL','CONTAS','IMPOSTOS','OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExpenseStatus" AS ENUM ('PENDENTE','PAGA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RecurringExpense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "dayOfMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringExpense_accountId_active_idx" ON "RecurringExpense"("accountId", "active");

CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTRO',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDENTE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "recurringId" TEXT,
    "competenceMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_recurringId_competenceMonth_key" ON "Expense"("recurringId", "competenceMonth");
CREATE INDEX IF NOT EXISTS "Expense_accountId_status_dueDate_idx" ON "Expense"("accountId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Expense_accountId_paidAt_idx" ON "Expense"("accountId", "paidAt");

DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NÃO precisa GRANT em PROD: o app conecta como `postgres` e as tabelas nascem com
-- owner = postgres. Omitir o GRANT também evita expor via Data API (anon/authenticated).
-- Validar: select to_regclass('public."Expense"'), to_regclass('public."RecurringExpense"');
