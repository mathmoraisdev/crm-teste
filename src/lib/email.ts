// Validação/normalização simples de e-mail. Suficiente para capturar o e-mail
// que o lead digita no WhatsApp (não precisa ser RFC-completo).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trima + lowercase e valida. Retorna null se vazio ou inválido. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Envia um e-mail transacional (confirmação de conta, reset de senha, etc.).
 *
 * - Com `RESEND_API_KEY` setada: envia via Resend (HTTP), usando `EMAIL_FROM`
 *   como remetente.
 * - Sem a chave (dev local): faz `console.info` do e-mail e retorna sucesso —
 *   assim o fluxo de cadastro/reset roda sem configurar nada.
 *
 * Nunca lança: qualquer falha vira `{ ok: false }` para não derrubar o fluxo
 * que chamou (ex.: o cadastro não deve quebrar se o e-mail falhar).
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendEmailInput): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "";

  // Modo dev: sem chave, apenas loga (não envia de verdade).
  if (!apiKey) {
    console.info(
      `[email] (dev, sem RESEND_API_KEY) para=${to} assunto="${subject}"\n${text ?? html}`,
    );
    return { ok: true };
  }

  // Erro de configuração comum: chave setada, mas remetente vazio → a Resend
  // rejeita com 400. Falha cedo com mensagem clara em vez de erro silencioso.
  if (!from) {
    console.error(
      "[email] RESEND_API_KEY setada mas EMAIL_FROM vazio — configure EMAIL_FROM (ex.: \"Disparador.ai <no-reply@seudominio.com>\"). E-mail não enviado.",
    );
    return { ok: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[email] Resend respondeu ${res.status} para=${to}: ${detail}`,
      );
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    // Falha de rede/etc. — loga e segue (não derruba o fluxo chamador).
    console.error(`[email] falha ao enviar para=${to}:`, err);
    return { ok: false };
  }
}
