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

/**
 * Valida se a entrada é um CELULAR brasileiro plausível — o que o WhatsApp
 * espera: DDD (11–99) + 9º dígito + 8 dígitos. Aceita valor mascarado ou cru
 * (normaliza antes). Rejeita fixo (10 dígitos) e internacional DE PROPÓSITO:
 * é usada só no link público, onde queremos um número com WhatsApp. O walk-in
 * interno segue leniente (pode anotar um fixo só p/ ter o contato).
 */
export function isBrMobile(raw: string): boolean {
  const e164 = normalizePhone(raw);
  if (!e164) return false;
  return /^\+55[1-9][0-9]9\d{8}$/.test(e164);
}

/**
 * Máscara progressiva de celular BR p/ inputs: "41999998888" → "(41) 99999-8888".
 * Só formata o que o usuário digitou (não completa), então é seguro em onChange.
 */
export function maskBrPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Variantes de um número BR para CASAMENTO (não para envio).
 *
 * O WhatsApp registra muitos celulares brasileiros SEM o 9º dígito, então um
 * inbound pode chegar de um JID canônico sem o 9 (ex.: +556993068151) enquanto o
 * lead foi salvo COM o 9 (+5569993068151) — ou o inverso. Sem tolerar isso, o
 * resolveLead não acha o lead e a resposta é descartada em silêncio.
 *
 * Devolve as formas E.164 plausíveis (sempre incluindo a original, primeiro).
 * Para números não-BR, devolve só a original. É o espelho, no inbound, do que o
 * pickSendJid já faz no envio.
 */
export function brPhoneVariants(e164: string): string[] {
  const variants = [e164];
  const m = e164.match(/^\+55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, local] = m;
    if (local.length === 9 && local.startsWith("9")) {
      variants.push(`+55${ddd}${local.slice(1)}`); // com 9 → sem 9
    } else if (local.length === 8) {
      variants.push(`+55${ddd}9${local}`); // sem 9 → com 9
    }
  }
  return variants;
}

/** Versão amigável para exibir na UI: +55 (11) 98888-1111 */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}
