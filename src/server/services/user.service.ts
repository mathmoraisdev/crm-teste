import { prisma } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizeEmail, sendEmail } from "@/lib/email";
import { generateToken, hashToken } from "@/lib/tokens";
import { env } from "@/lib/env";

/** Base para os links nos e-mails (sem barra final). */
function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// Validade dos tokens one-time.
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1h
const EMAIL_VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24h

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  whatsapp?: string;
}

/** Cria uma conta. Lança erro amigável em e-mail inválido/duplicado. */
export async function registerUser(
  input: RegisterInput,
): Promise<{ id: string; sessionEpoch: number }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("E-mail inválido.");
  if (input.password.length < 8) {
    throw new Error("A senha precisa ter ao menos 8 caracteres.");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw new Error("Já existe uma conta com este e-mail.");

  const trialDays = env.TRIAL_DAYS;
  const accessUntil =
    trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      whatsapp: input.whatsapp?.trim() || null,
      passwordHash: hashPassword(input.password),
      // Nasce AUTO. Por padrão (TRIAL_DAYS=0) accessUntil=null → SUSPENSO: o
      // admin libera o teste (3/7 dias) ou lança o pagamento no /financeiro.
      // Com TRIAL_DAYS>0 ganha trial automático de N dias.
      billingOverride: "AUTO",
      accessUntil,
      // Nasce no plano de entrada: trial/INICIAL roda só o modelo econômico e tem
      // pool de créditos. plan=null fica reservado a grandfather que o admin marca.
      plan: "INICIAL",
    },
    select: { id: true, sessionEpoch: true },
  });
  return { id: user.id, sessionEpoch: user.sessionEpoch };
}

/** Verifica credenciais; devolve `{ id, sessionEpoch }` do usuário ou null. */
export async function authenticateUser(
  rawEmail: string,
  password: string,
): Promise<{ id: string; sessionEpoch: number } | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  return verifyPassword(password, user.passwordHash)
    ? { id: user.id, sessionEpoch: user.sessionEpoch }
    : null;
}

/** Dados públicos do usuário (para a UI). */
export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, whatsapp: true, emailVerified: true, createdAt: true },
  });
}

// ───────────────────────── Reset de senha ─────────────────────────

/**
 * Cria um token de reset e envia o e-mail com o link.
 *
 * Não revela se a conta existe: se o e-mail não bate com nenhuma conta,
 * simplesmente não faz nada (a rota responde 200 de qualquer jeito).
 * Best-effort no envio — não lança se o e-mail falhar.
 */
export async function createPasswordReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!user) return; // não vaza existência da conta

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  const link = `${appUrl()}/redefinir-senha?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Redefinir sua senha — Disparador.ai",
    html: `<p>Olá${user.name ? `, ${user.name}` : ""}!</p>
<p>Recebemos um pedido para redefinir a senha da sua conta. Clique no link abaixo para escolher uma nova senha (válido por 1 hora):</p>
<p><a href="${link}">Redefinir minha senha</a></p>
<p>Se você não fez esse pedido, pode ignorar este e-mail.</p>`,
    text: `Para redefinir sua senha, acesse: ${link}\n(Válido por 1 hora. Se não foi você, ignore este e-mail.)`,
  });
}

/**
 * Troca a senha a partir de um token válido (não expirado, não usado).
 * Marca o token como usado. Lança erro amigável se inválido/expirado.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new Error("A senha precisa ter ao menos 8 caracteres.");
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("Link inválido ou expirado. Solicite um novo.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      // Incrementa o epoch: desloga qualquer sessão antiga após o reset.
      data: { passwordHash: hashPassword(newPassword), sessionEpoch: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
}

/**
 * Troca a senha do usuário LOGADO, exigindo a senha atual (self-service no app,
 * sem token/e-mail). Lança erro amigável se a senha atual estiver errada, a nova
 * for curta ou igual à atual.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ sessionEpoch: number }> {
  if (newPassword.length < 8) {
    throw new Error("A nova senha precisa ter ao menos 8 caracteres.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new Error("Conta não encontrada.");

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error("Senha atual incorreta.");
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    throw new Error("A nova senha precisa ser diferente da atual.");
  }

  // Incrementa o epoch: invalida as outras sessões. O chamador re-assina o
  // cookie do dispositivo atual com o novo epoch para não se deslogar.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(newPassword), sessionEpoch: { increment: 1 } },
    select: { sessionEpoch: true },
  });
  return { sessionEpoch: updated.sessionEpoch };
}

// ──────────────────── Verificação de e-mail ────────────────────

/**
 * Gera um token de verificação de e-mail e envia o link de confirmação.
 * Best-effort: não lança se o e-mail falhar (o cadastro não pode quebrar).
 */
export async function createEmailVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerified: true },
  });
  if (!user || user.emailVerified) return; // já verificado: nada a fazer

  const token = generateToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
    },
  });

  const link = `${appUrl()}/api/auth/verify?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Confirme seu e-mail — Disparador.ai",
    html: `<p>Olá${user.name ? `, ${user.name}` : ""}!</p>
<p>Falta pouco para concluir seu cadastro. Confirme seu e-mail clicando no link abaixo (válido por 24 horas):</p>
<p><a href="${link}">Confirmar meu e-mail</a></p>`,
    text: `Confirme seu e-mail acessando: ${link}\n(Válido por 24 horas.)`,
  });
}

/**
 * Valida o token de verificação e marca `emailVerified = now`.
 * Retorna true em sucesso; false se o token for inválido/expirado.
 */
export async function verifyEmailToken(token: string): Promise<boolean> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.expiresAt < new Date()) return false;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    // Token é one-time: consome todos os pendentes desta conta.
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);
  return true;
}

// ───────────────────── LGPD: exportar / apagar ─────────────────────

/** Tamanho do lote ao exportar leads — não carrega a base inteira em memória. */
export const EXPORT_LEADS_PAGE = 1000;

/**
 * Cabeçalho da exportação LGPD: conta + campanhas + números (dados PEQUENOS e
 * limitados). Os leads (potencialmente dezenas de milhares, cada um com todas as
 * mensagens) NÃO entram aqui — vêm em lotes por `iterateUserLeads`, para a rota
 * montar o JSON em stream sem segurar tudo na memória.
 */
export async function exportAccountHeader(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      whatsapp: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      campaigns: true,
      whatsAppNumbers: {
        // Não exporta credenciais/sessão do Baileys — só metadados do chip.
        select: {
          id: true,
          label: true,
          phone: true,
          status: true,
          dailyCap: true,
          connectedAt: true,
          bannedAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!user) throw new Error("Conta não encontrada.");

  return {
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      whatsapp: user.whatsapp,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    campaigns: user.campaigns,
    whatsAppNumbers: user.whatsAppNumbers,
  };
}

/**
 * Itera os leads do usuário em páginas de `EXPORT_LEADS_PAGE`, cada um com
 * mensagens/qualificação/reunião. Async generator: a rota consome lote a lote e
 * vai escrevendo no stream — o pico de memória é uma página, não a base toda.
 */
export async function* iterateUserLeads(userId: string) {
  for (let skip = 0; ; skip += EXPORT_LEADS_PAGE) {
    const batch = await prisma.lead.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      skip,
      take: EXPORT_LEADS_PAGE,
      include: {
        messages: true,
        qualification: true,
        meeting: true,
        campaign: { select: { id: true, name: true } },
      },
    });
    if (batch.length === 0) break;
    yield batch;
  }
}

/**
 * Apaga a conta do usuário. O cascade do schema (onDelete: Cascade) remove
 * leads, mensagens, campanhas, números e tokens associados.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
