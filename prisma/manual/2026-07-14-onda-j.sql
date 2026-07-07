-- Onda J — Gateway PagBank (Pix). Idempotente. Aplicar no Supabase SQL Editor.
-- ADD VALUE IF NOT EXISTS roda fora de transação; rodar esta linha SOZINHA
-- (Postgres não deixa usar o valor novo do enum na mesma transação que o criou).
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAGBANK';
