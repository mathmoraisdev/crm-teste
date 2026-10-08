-- Renomeia o ID do modelo "GPT LUNA 6" de gpt-luna-6 (inexistente na API da
-- OpenAI → 404 model_not_found, lead em AI_ERROR sem resposta no WhatsApp)
-- para gpt-6-luna (ID real confirmado na API da OpenAI).
-- Migration de dados apenas; não altera o schema.
UPDATE "WhatsAppNumber" SET "aiModel" = 'gpt-6-luna' WHERE "aiModel" = 'gpt-luna-6';
