-- Novo estado de atendimento: IA falhou ao responder (provedor fora/chave
-- inválida/timeout após retries do SDK). Sinaliza ao operador que o lead ficou
-- sem resposta automática e precisa de atendimento humano. Espelha o valor
-- AI_ERROR adicionado ao enum AttendanceStatus no schema.
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'AI_ERROR';
