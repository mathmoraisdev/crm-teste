import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { prisma } from "@/server/db/client";

/**
 * Lê o cookie de sessão e devolve o id do usuário logado (ou null).
 * Usado pelas rotas de API (runtime Node) e server components para escopar os
 * dados por conta.
 *
 * Além da assinatura HMAC (já validada em `verifySession`), confere o
 * `sessionEpoch` do token contra o banco: ao trocar/resetar a senha o epoch é
 * incrementado, então cookies emitidos antes deixam de valer (logout das outras
 * sessões). O middleware (Edge) segue só na assinatura — esta checagem com banco
 * roda aqui, no Node, por onde passa todo acesso a dados da conta.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.u },
    select: { sessionEpoch: true },
  });
  if (!user || user.sessionEpoch !== session.v) return null;
  return session.u;
}
