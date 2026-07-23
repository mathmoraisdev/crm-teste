/**
 * Detecção de opt-out em mensagens inbound. Defesa nº 1 contra denúncias
 * (o que mais derruba a qualidade do número). Casamento por palavra inteira,
 * normalizado (sem acento, minúsculo), para não disparar em substrings
 * (ex.: "comparar" contém "parar" mas NÃO é opt-out).
 */
const OPT_OUT_KEYWORDS = [
  "parar", "pare", "sair", "stop", "cancelar", "cancela",
  "descadastrar", "remover", "remova", "sigam",
];

// frases multi-palavra tratadas à parte
const OPT_OUT_PHRASES = ["nao quero mais", "nao quero", "para de", "pare de"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // pontuação → espaço
    .trim();
}

export function isOptOut(text: string): boolean {
  const norm = normalize(text);
  if (OPT_OUT_PHRASES.some((p) => norm.includes(p))) return true;
  const tokens = new Set(norm.split(/\s+/));
  return OPT_OUT_KEYWORDS.some((k) => tokens.has(k));
}
