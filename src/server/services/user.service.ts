import { prisma } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/email";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  whatsapp?: string;
}

/** Cria uma conta. Lança erro amigável em e-mail inválido/duplicado. */
export async function registerUser(input: RegisterInput): Promise<{ id: string }> {
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

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      whatsapp: input.whatsapp?.trim() || null,
      passwordHash: hashPassword(input.password),
    },
    select: { id: true },
  });
  return { id: user.id };
}

/** Verifica credenciais; devolve o id do usuário ou null. */
export async function authenticateUser(
  rawEmail: string,
  password: string,
): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user.id : null;
}

/** Dados públicos do usuário (para a UI). */
export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, whatsapp: true },
  });
}
