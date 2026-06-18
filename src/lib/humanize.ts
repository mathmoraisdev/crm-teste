export interface TypingOpts {
  msPerChar: number;
  maxMs: number;
}

/**
 * Quanto tempo "digitar" antes de enviar — proporcional ao texto, com teto e
 * jitter. `rand` é injetável p/ teste (no uso real, Math.random).
 */
export function typingDelayMs(
  textLength: number,
  opts: TypingOpts,
  rand: () => number = Math.random,
): number {
  const base = Math.min(textLength * opts.msPerChar, opts.maxMs);
  const jitter = Math.round(base * 0.3 * rand());
  return base + jitter;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
