/** Decisão pura: este áudio deve ir para a transcrição?
 *  - feature desligada → não.
 *  - duração conhecida e acima do teto → não (áudio longo; protege a chave do sistema).
 *  - duração desconhecida → sim (o teto de 25MB do download decide o limite real).
 */
export function shouldTranscribe(
  audio: { seconds?: number | null },
  cfg: { enabled: boolean; maxSeconds: number },
): boolean {
  if (!cfg.enabled) return false;
  if (typeof audio.seconds === "number" && audio.seconds > cfg.maxSeconds) return false;
  return true;
}
