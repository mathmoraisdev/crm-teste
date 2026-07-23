import { env } from "@/lib/env";

/** Conjunto de e-mails admin do env (`ADMIN_EMAILS`), normalizados. */
export function adminEmailSet(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True se o e-mail pertence à lista de administradores. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email.trim().toLowerCase());
}
