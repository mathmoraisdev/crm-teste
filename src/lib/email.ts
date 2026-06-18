// Validação/normalização simples de e-mail. Suficiente para capturar o e-mail
// que o lead digita no WhatsApp (não precisa ser RFC-completo).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trima + lowercase e valida. Retorna null se vazio ou inválido. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}
