import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, verifySession } from "@/lib/auth";

/**
 * Protege todo o dashboard com login. Roda no Edge runtime.
 *
 * Rotas públicas (nunca exigem login):
 *  - /  e  /signup         — landing e cadastro (marketing)
 *  - /login e /api/auth/*  — a própria tela e API de autenticação/cadastro
 *  - /api/webhooks/*       — a Meta chama o webhook do WhatsApp; tem verificação
 *                            própria (verify_token + assinatura X-Hub-Signature)
 *  - /api/cron/*           — disparo serverless, protegido pelo CRON_SECRET
 *  - páginas legais / fluxos de conta (privacidade, termos, cookies, consultor,
 *    esqueci/redefinir senha, verificar e-mail) + /api/consultant (lead público)
 */
const PUBLIC_PREFIXES = [
  "/",
  "/landing", // preview da landing (sempre acessível, mesmo com a raiz indo pro login)
  "/signup",
  "/login",
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
  "/privacidade",
  "/termos",
  "/cookies",
  "/consultor",
  "/esqueci-senha",
  "/redefinir-senha",
  "/verificar-email",
  "/api/consultant",
  // Auto-agendamento online: link público sem login (/agendar/<slug>) + sua API
  // (/api/agendar/<slug>/...). A regra startsWith(p + "/") cobre slug e subcaminhos.
  "/agendar",
  "/api/agendar",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export async function middleware(req: NextRequest) {
  // Auth desligada (variáveis não configuradas) → não bloqueia nada.
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // Não autenticado:
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Aplica a tudo, exceto assets estáticos do Next e arquivos de imagem públicos.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
