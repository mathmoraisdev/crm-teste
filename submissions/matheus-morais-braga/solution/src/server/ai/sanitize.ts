/**
 * Saneia texto gerado pela IA antes de enviar pelo WhatsApp.
 *
 * O WhatsApp NÃO renderiza markdown. Quando a IA escreve um link no formato
 * `[texto](url)`, o cliente vê o texto E a url crus, lado a lado — no caso de
 * `[url](url)` a URL aparece DUPLICADA. Aqui convertemos links markdown para
 * texto plano amigável ao WhatsApp.
 */

const MARKDOWN_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * O transcript é montado com rótulos de locutor ("Vendedor:", "Lead:") — ver
 * formatTranscript. Modelos do tier barato às vezes imitam esse formato e começam
 * a resposta com "Vendedor: ..." mesmo o prompt pedindo só o texto da mensagem.
 * Aqui removemos esse prefixo de locutor caso escape, para não vazar ao cliente.
 */
const SPEAKER_LABEL = /^\s*(?:vendedor|lead|atendente|sdr|assistente)\s*:\s*/i;

/** Remove um rótulo de locutor no início da mensagem, se o modelo o vazou. */
export function stripSpeakerLabel(text: string): string {
  return text.replace(SPEAKER_LABEL, "");
}

/** Normaliza p/ comparar texto vs destino (ignora barra final). */
function sameTarget(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/**
 * Converte links markdown `[texto](url)` em texto plano:
 * - `[url](url)` ou texto == destino  → apenas a URL (sem duplicar).
 * - `[texto](url)` com texto distinto → `texto (url)`.
 * - `[](url)` (texto vazio)           → apenas a URL.
 * Demais marcações são preservadas — atacamos só o bug de link duplicado.
 */
export function stripMarkdownLinks(text: string): string {
  return text.replace(MARKDOWN_LINK, (_match, label: string, url: string) => {
    const t = label.trim();
    if (!t || sameTarget(t, url)) return url;
    return `${t} (${url})`;
  });
}
