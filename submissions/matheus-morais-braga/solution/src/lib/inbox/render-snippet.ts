// Resolve variáveis {{placeholder}} de uma resposta rápida na inserção.
// Placeholders conhecidos são trocados pelo valor (com fallback vazio quando o
// valor não existe); placeholders DESCONHECIDOS são removidos (viram vazio) para
// nunca vazar "{{...}}" cru na mensagem ao cliente. Puro e sem efeitos.

export interface SnippetVars {
  nome?: string | null;
}

// Placeholders suportados hoje. Ampliar aqui conforme surgirem novos.
const KNOWN = new Set<keyof SnippetVars>(["nome"]);

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderSnippet(body: string, vars: SnippetVars = {}): string {
  return body.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim() as keyof SnippetVars;
    if (!KNOWN.has(key)) return ""; // desconhecido → limpa, não vaza cru
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}
