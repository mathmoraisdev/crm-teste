import { env } from "@/lib/env";

/**
 * Fusos horários brasileiros (IANA) oferecidos na UI do número de WhatsApp.
 * Cobrem todos os fusos vigentes no BR. O `value` é o identificador IANA usado
 * pelo `Intl.DateTimeFormat` e armazenado em `WhatsAppNumber.timezone`.
 *
 * O sistema é multi-estado: cada número (empresa) tem seu próprio fuso, então a
 * IA consegue saber a data/hora real do expediente de qualquer cartório/loja do
 * Brasil a partir do mesmo prompt — sem precisar editar o prompt por cliente.
 */
export const BR_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Noronha", label: "Fernando de Noronha/PE (UTC−2)" },
  { value: "America/Sao_Paulo", label: "São Paulo/SP, Rio de Janeiro/RJ, Brasília/DF (UTC−3)" },
  { value: "America/Bahia", label: "Salvador/BA (UTC−3)" },
  { value: "America/Fortaleza", label: "Fortaleza/CE (UTC−3)" },
  { value: "America/Recife", label: "Recife/PE (UTC−3)" },
  { value: "America/Maceio", label: "Maceió/AL (UTC−3)" },
  { value: "America/Araguaina", label: "Palmas/TO (UTC−3)" },
  { value: "America/Belem", label: "Belém/PA (UTC−3)" },
  { value: "America/Manaus", label: "Manaus/AM (UTC−4)" },
  { value: "America/Cuiaba", label: "Cuiabá/MT (UTC−4)" },
  { value: "America/Porto_Velho", label: "Porto Velho/RO (UTC−4)" },
  { value: "America/Rio_Branco", label: "Rio Branco/AC (UTC−5)" },
];

const BR_TIMEZONE_SET = new Set(BR_TIMEZONES.map((t) => t.value));

/** true quando `tz` é um fuso IANA brasileiro reconhecido pela lista. */
export function isValidBrTimezone(tz: string | null | undefined): tz is string {
  return !!tz && BR_TIMEZONE_SET.has(tz);
}

/**
 * Resolve o fuso efetivo de um número: valida contra a lista de fusos BR e cai
 * em `env.SCHEDULING_TIMEZONE` (default Brasília) quando ausente/inálido. Nunca
 * devolve null/vazio — é a fonte canônica para a IA e para a UI.
 */
export function resolveTimezone(tz: string | null | undefined): string {
  return isValidBrTimezone(tz) ? tz : env.SCHEDULING_TIMEZONE;
}
