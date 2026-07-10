-- Tema das páginas públicas (cardápio + agendamento + acompanhamento), escolha do lojista.
-- Nasce claro; NOT NULL com default retro-preenche as linhas existentes.
-- Idempotente: PROD roda `migrate deploy` no boot e não pode colidir com estado prévio.
ALTER TABLE "AccountBranding" ADD COLUMN IF NOT EXISTS "publicTheme" TEXT NOT NULL DEFAULT 'light';
