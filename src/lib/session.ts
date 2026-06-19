import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Lê o cookie de sessão e devolve o id do usuário logado (ou null).
 * Usado pelas rotas de API (runtime Node) para escopar os dados por conta.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  return session?.u ?? null;
}
