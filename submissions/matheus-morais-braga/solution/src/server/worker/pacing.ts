/** Pausa por chip entre envios: base + jitter aleatório. rand injetável p/ teste. */
export function perChipDelayMs(minMs: number, jitterMs: number, rand: () => number = Math.random): number {
  return Math.max(0, minMs) + Math.round(Math.max(0, jitterMs) * rand());
}
