/** Mantém só dígitos; valida comprimento de CPF (11) ou CNPJ (14). Vazio → null. */
export function normalizeDocument(raw: string | null | undefined, type: "PF" | "PJ"): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const expected = type === "PJ" ? 14 : 11;
  if (digits.length !== expected) {
    throw new Error(type === "PJ" ? "CNPJ deve ter 14 dígitos." : "CPF deve ter 11 dígitos.");
  }
  return digits;
}
