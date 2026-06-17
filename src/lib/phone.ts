/**
 * Normalização de telefone para E.164 (foco: números brasileiros).
 *
 * Aceita formatos como "(11) 98888-1111", "11 98888 1111", "+55 11 98888-1111",
 * "5511988881111" e devolve "+5511988881111".
 *
 * Regra: se não vier com DDI, assume Brasil (+55). Validação leve — o objetivo
 * é desduplicar e ter um formato consistente, não validar carrier.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  // Mantém só dígitos (e um eventual + inicial).
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");

  if (digits.length === 0) return null;

  // Já veio com DDI explícito.
  if (hadPlus) {
    return isPlausibleE164(`+${digits}`) ? `+${digits}` : null;
  }

  // 55 + 10/11 dígitos (DDI Brasil já incluso, sem +).
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // 10 (fixo) ou 11 (celular) dígitos → assume Brasil.
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  // Outros tamanhos: aceita como E.164 cru se plausível.
  return isPlausibleE164(`+${digits}`) ? `+${digits}` : null;
}

function isPlausibleE164(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

/** Versão amigável para exibir na UI: +55 (11) 98888-1111 */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}
