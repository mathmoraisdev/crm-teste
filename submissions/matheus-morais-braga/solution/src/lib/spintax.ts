/**
 * Spintax: `{a|b|c}` → uma das opções. `pick(n)` recebe o nº de opções e
 * devolve o índice escolhido (injetável p/ testar; no uso real é aleatório).
 *
 * Só grupos COM `|` são tratados como spintax. `{nome}` (sem pipe) é deixado
 * intacto de propósito — assim o spin pode rodar ANTES do `renderTemplate` sem
 * corromper o placeholder `{{nome}}`. Não aninha grupos (YAGNI) — resolve da
 * esquerda p/ direita.
 */
export function renderSpintax(
  text: string,
  pick: (count: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group: string) => {
    const opts = group.split("|");
    const i = Math.max(0, Math.min(opts.length - 1, pick(opts.length)));
    return opts[i];
  });
}
